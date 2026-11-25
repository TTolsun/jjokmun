import { element } from './dom.js';

export function bindReplyDialog(change) {
  const dialog = element('reply-dialog');
  const input = element('reply-edit-input');
  const confirm = element('reply-dialog-confirm');
  const cancel = element('reply-dialog-cancel');
  const status = element('reply-dialog-status');
  let target;

  function reset() {
    target = undefined;
    input.value = '';
    element('reply-delete-text').textContent = '';
    element('reply-delete-message').textContent = '';
    status.textContent = '';
    if (dialog.open) dialog.close();
  }

  function open(action, memoId, reply) {
    const editing = action === 'edit';
    target = { action, memoId, replyId: reply.id, original: reply.text };
    element('reply-dialog-title').textContent = editing ? '답장 수정' : '답장을 삭제할까요?';
    element('reply-edit-field').hidden = !editing;
    element('reply-delete-preview').hidden = editing;
    input.disabled = !editing;
    input.value = editing ? reply.text : '';
    element('reply-delete-text').textContent = editing ? '' : reply.text;
    element('reply-delete-message').textContent = '삭제한 답장은 되돌릴 수 없습니다.';
    confirm.textContent = editing ? '수정 저장' : '삭제';
    confirm.classList.toggle('danger', !editing);
    status.textContent = '';
    dialog.showModal();
    (editing ? input : cancel).focus();
  }

  function closeAndFocus() {
    const { replyId, action } = target;
    reset();
    const row = element('detail-replies').querySelector(`[data-reply-id="${CSS.escape(replyId)}"]`);
    const compose = element('reply-compose');
    const fallback = compose.open ? element('reply-input') : compose.querySelector('summary');
    (row?.querySelector(`[data-action="${action}"]`) || fallback).focus();
  }

  cancel.addEventListener('click', closeAndFocus);
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    if (!confirm.disabled && target) closeAndFocus();
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault();
  });
  element('reply-dialog-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!target || confirm.disabled) return;
    const pending = target;
    const editing = pending.action === 'edit';
    const text = input.value.trim();
    if (editing && !text) {
      status.textContent = '답장을 한 줄로 적어 주세요.';
      input.focus();
      return;
    }
    confirm.disabled = true;
    cancel.disabled = true;
    input.readOnly = true;
    try {
      await change(draft => {
        const memo = draft.memos.find(item => item.id === pending.memoId);
        const reply = memo?.replies.find(item => item.id === pending.replyId);
        if (!reply) throw new Error('이미 삭제된 답장입니다.');
        if (reply.text !== pending.original) throw new Error('다른 탭에서 답장이 바뀌었습니다. 취소한 뒤 최신 내용을 확인해 주세요.');
        if (editing) {
          reply.text = text;
        } else {
          memo.replies = memo.replies.filter(item => item.id !== reply.id);
          if (draft.shop?.guestMemoId === memo.id && draft.shop.guestReplyId === reply.id) delete draft.shop.guestReplyId;
          draft.props = draft.props.filter(item => item.memoId !== memo.id || item.replyId !== reply.id);
        }
      });
      if (target === pending) {
        closeAndFocus();
        element('detail-status').textContent = editing ? '답장을 수정했어요.' : '답장을 삭제했어요.';
      }
    } catch (error) {
      if (target === pending) status.textContent = error.message || '저장하지 못했습니다. 다시 시도해 주세요.';
    } finally {
      confirm.disabled = false;
      cancel.disabled = false;
      input.readOnly = false;
    }
  });
  return { open, reset };
}
