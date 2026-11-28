import { BACKUP_FORMAT, MAX_BACKUP_BYTES, encryptBackup, decryptBackup } from '../crypto.js';
import { mergeImport, undoImport } from '../imports.js';
import { backupSnapshot, validateBackup } from '../store.js';
import { LockedError, disableVault, enableVault, readPayload } from '../vault.js';
import { element } from './dom.js';

export function bindBackupDialogs({ activeView, today, setStatus, announce, refresh, renderResult }) {
  const passwordDialog = element('backup-password-dialog');
  const previewDialog = element('import-preview-dialog');
  const undoDialog = element('undo-dialog');
  let passwordAction;
  let backupEnvelope;
  let preview;
  let undoToken;

  const passwordPrompts = {
    export: ['암호화 백업 내보내기', '이 파일을 복원할 때 사용할 비밀번호를 정하세요.', true],
    import: ['암호화 백업 열기', '이 백업을 만들 때 정한 비밀번호를 입력하세요.', false],
    enable: ['저장소 암호화', '메모를 쪽문 저장 파일에 암호화해 보관합니다. 기존 .md, .txt와 평문 백업은 폴더에 남으며 그대로 열 수 있습니다. 저장소를 다시 열려면 이 비밀번호가 필요합니다.', true],
    disable: ['저장소 암호화 해제', '계속하면 이 기기에 남은 기록과 되돌리기 기록을 평문으로 저장합니다.', false]
  };

  function askPassword(action) {
    if (activeView() === undefined) return;
    passwordAction = action;
    const [title, description, confirm] = passwordPrompts[action];
    element('password-title').textContent = title;
    element('password-description').textContent = description;
    element('confirm-password-field').hidden = !confirm;
    element('backup-password-confirm').required = confirm;
    element('backup-password-form').reset();
    setStatus('password-status', '');
    passwordDialog.showModal();
  }

  function rejectStaleView(expected) {
    if (expected !== activeView()) throw new LockedError();
  }

  function downloadBackup(backup) {
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    if (blob.size > MAX_BACKUP_BYTES) throw new Error('백업이 가져오기 제한인 8 MiB를 넘습니다.');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'jjokmun-' + today() + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function createPreview(backup, expected) {
    const result = await readPayload();
    rejectStaleView(expected);
    const date = today();
    const { summary } = mergeImport(result.payload.state, backup, date);
    return { backup, summary, revision: result.revision, date };
  }

  function showPreview(next) {
    preview = next;
    const summary = next.summary;
    const list = document.createElement('dl');
    for (const [label, field] of [
      ['추가할 메모', 'newMemos'], ['바뀔 원문', 'updatedMemos'], ['새 답장', 'newReplies'],
      ['입간판 기록', 'daily'], ['충돌', 'conflicts']
    ]) {
      const term = document.createElement('dt');
      term.textContent = label;
      const value = document.createElement('dd');
      value.textContent = summary[field] + '개';
      list.append(term, value);
    }
    for (const [key, label] of [['shop', '책방 운영 기록'], ['business', '가구 배치와 단골 기록'], ['pet', '펫 돌봄과 도감 기록']]) {
      if (!next.backup[key]) continue;
      const term = document.createElement('dt');
      term.textContent = label;
      const value = document.createElement('dd');
      value.textContent = key === 'pet' ? (summary.pet || '현재 기록 유지') : (summary[key] ? '복원' : '현재 기록 유지');
      list.append(term, value);
    }
    const reasons = document.createElement('ul');
    for (const reason of summary.reasons) {
      const item = document.createElement('li');
      item.textContent = reason;
      reasons.append(item);
    }
    element('import-summary').replaceChildren(list);
    if (reasons.children.length) element('import-summary').append(reasons);
    if (!previewDialog.open) {
      setStatus('import-status', '');
      previewDialog.showModal();
    }
  }

  element('export-backup').addEventListener('click', () => askPassword('export'));
  element('enable-vault').addEventListener('click', () => askPassword('enable'));
  element('disable-vault').addEventListener('click', () => askPassword('disable'));
  for (const [dialog, cancelId, confirmId] of [
    [passwordDialog, 'backup-password-cancel', 'backup-password-submit'],
    [previewDialog, 'import-cancel', 'import-confirm'],
    [undoDialog, 'undo-cancel', 'undo-confirm']
  ]) {
    element(cancelId).addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', (event) => {
      if (element(confirmId).disabled) event.preventDefault();
    });
  }
  passwordDialog.addEventListener('close', () => {
    if (!passwordDialog.open) {
      element('backup-password-form').reset();
      passwordAction = undefined;
      backupEnvelope = undefined;
    }
  });

  element('backup-password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = element('backup-password-submit');
    const expected = activeView();
    if (expected === undefined || button.disabled || !passwordAction) return;
    const action = passwordAction;
    const password = element('backup-password').value;
    if (passwordPrompts[action][2] && password !== element('backup-password-confirm').value) {
      setStatus('password-status', '비밀번호 확인이 일치하지 않습니다.');
      return;
    }
    const envelope = backupEnvelope;
    element('backup-password-form').reset();
    button.disabled = true;
    element('backup-password-cancel').disabled = true;
    setStatus('password-status', '처리 중입니다.');
    try {
      if (action === 'export') {
        const result = await readPayload();
        rejectStaleView(expected);
        const backup = await encryptBackup(validateBackup(backupSnapshot(result.payload.state)), password);
        // Recheck access after encryption in case another tab locked the vault.
        await readPayload();
        rejectStaleView(expected);
        downloadBackup(backup);
        passwordDialog.close();
        setStatus('settings-status', '암호화 백업을 내보냈어요.');
      } else if (action === 'import') {
        const backup = validateBackup(await decryptBackup(envelope, password));
        const next = await createPreview(backup, expected);
        passwordDialog.close();
        showPreview(next);
      } else {
        if (action === 'enable') await enableVault(password);
        else await disableVault(password);
        announce('security');
        rejectStaleView(expected);
        passwordDialog.close();
        await refresh();
        setStatus('settings-status', action === 'enable' ? '저장소를 암호화했어요.' : '저장소 암호화를 해제했어요.');
      }
    } catch (error) {
      if (expected === activeView()) setStatus('password-status', error.message || '요청을 처리하지 못했습니다.');
    } finally {
      button.disabled = false;
      element('backup-password-cancel').disabled = false;
    }
  });

  element('choose-backup').addEventListener('click', () => {
    if (activeView() !== undefined) element('import-backup').click();
  });
  element('import-backup').addEventListener('change', async (event) => {
    const input = event.currentTarget;
    const file = input.files[0];
    const expected = activeView();
    if (expected === undefined || !file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      input.value = '';
      setStatus('settings-status', '8 MiB 이하의 백업 파일을 선택해 주세요.');
      return;
    }
    const button = element('choose-backup');
    button.disabled = true;
    try {
      let parsed;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error('JSON 파일을 읽지 못했습니다. jjokmun 백업 파일을 선택해 주세요.');
      }
      rejectStaleView(expected);
      if (parsed?.format === BACKUP_FORMAT) {
        backupEnvelope = parsed;
        askPassword('import');
      } else {
        showPreview(await createPreview(validateBackup(parsed), expected));
      }
    } catch (error) {
      if (expected === activeView()) setStatus('settings-status', error.message || '백업을 읽지 못했습니다.');
    } finally {
      input.value = '';
      button.disabled = false;
    }
  });

  previewDialog.addEventListener('close', () => {
    if (!previewDialog.open) {
      preview = undefined;
      element('import-summary').replaceChildren();
    }
  });
  element('import-confirm').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const pending = preview;
    const expected = activeView();
    if (expected === undefined || !pending || button.disabled) return;
    const date = today();
    const token = crypto.randomUUID();
    let revised;
    let imported;
    button.disabled = true;
    element('import-cancel').disabled = true;
    try {
      const result = await readPayload((draft, payload, revision) => {
        revised = imported = undefined;
        if (revision !== pending.revision || date !== pending.date) {
          const { summary } = mergeImport(structuredClone(draft), pending.backup, date);
          revised = { backup: pending.backup, summary, revision, date };
          return false;
        }
        const plan = mergeImport(draft, pending.backup, date);
        if (!plan.undo) return false;
        validateBackup(draft);
        payload.undo = { token, ...plan.undo };
        imported = plan.summary;
      });
      rejectStaleView(expected);
      if (revised) {
        showPreview(revised);
        setStatus('import-status', '미리보기 이후 저장된 기록이 바뀌었습니다. 다시 확인해 주세요.');
        return;
      }
      previewDialog.close();
      renderResult(result, date);
      if (imported) announce('changed');
      setStatus('settings-status', imported ? '백업을 가져왔어요.' : '추가하거나 바꿀 기록이 없습니다.');
    } catch (error) {
      if (expected === activeView()) setStatus('import-status', error.message || '가져오지 못했습니다. 기존 기록은 그대로입니다.');
    } finally {
      button.disabled = false;
      element('import-cancel').disabled = false;
    }
  });

  element('undo-import').addEventListener('click', async () => {
    const expected = activeView();
    if (expected === undefined) return;
    try {
      const result = await readPayload();
      rejectStaleView(expected);
      undoToken = result.payload.undo?.token;
      if (undoToken && !undoDialog.open) undoDialog.showModal();
    } catch (error) {
      if (expected === activeView()) setStatus('undo-result', error.message);
    }
  });
  element('undo-confirm').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const expected = activeView();
    if (expected === undefined || button.disabled || !undoToken) return;
    const token = undoToken;
    const date = today();
    let summary;
    button.disabled = true;
    element('undo-cancel').disabled = true;
    try {
      const result = await readPayload((draft, payload) => {
        if (payload.undo?.token !== token) throw new Error('다른 탭에서 가져오기 기록이 바뀌었습니다. 다시 확인해 주세요.');
        summary = undoImport(draft, payload.undo, date);
        payload.undo = null;
      });
      rejectStaleView(expected);
      undoDialog.close();
      renderResult(result, date);
      announce('changed');
      let message = '가져오기를 되돌렸어요. 제거한 메모 ' + summary.memos + '개, 복원한 원문 '
        + summary.originals + '개, 제거한 답장 ' + summary.replies + '개.';
      if (summary.pet) message += ' 펫 기록도 가져오기 전으로 돌아갔어요.';
      setStatus('undo-result', summary.conflicts ? message + ' 충돌 ' + summary.conflicts + '건. ' + summary.reasons.join(' ') : message);
    } catch (error) {
      if (expected === activeView()) {
        undoDialog.close();
        setStatus('undo-result', error.message || '가져오기를 되돌리지 못했습니다.');
      }
    } finally {
      button.disabled = false;
      element('undo-cancel').disabled = false;
    }
  });

  return function clearBackupDialogs() {
    element('backup-password-form').reset();
    element('import-backup').value = '';
    for (const id of ['password-status', 'import-status', 'import-summary', 'undo-result']) {
      element(id).replaceChildren();
    }
    backupEnvelope = undefined;
    passwordAction = undefined;
    preview = undefined;
    undoToken = undefined;
  };
}
