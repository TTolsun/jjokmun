const { seedEncryptedVault } = require('./legacy-vault.cjs');
const assert = require('node:assert/strict');
const {openSection, selectFolder} = require('./browser.cjs');

const flowchart = [
  'flowchart TD',
  '  Start[자료 접수] --> End[분류 완료]'
].join('\n');

const mermaidSequence = [
  'sequenceDiagram',
  '  participant Reader as 독자',
  '  participant Clerk as 서점원',
  '  Reader->>Clerk: 책을 물어봄'
].join('\n');

const plantumlSequence = [
  '@startuml',
  'participant "기록자" as Writer',
  'participant "동료" as Colleague',
  'Writer -> Colleague: 기록을 보냄',
  '@enduml'
].join('\n');

const plantumlClass = [
  '@startuml',
  'class "자료함" as Archive',
  'class "책갈피" as Bookmark',
  'Archive "1" *-- "*" Bookmark',
  '@enduml'
].join('\n');

function fence(language, source) {
  return ['```' + language, source, '```'].join('\n');
}

async function openSource(page, path) {
  const row = page.locator('#archive-list button').filter({has: page.getByText(path, {exact: true})});
  await row.click();
  await page.waitForFunction(path => document.querySelector('#detail-path').textContent === path, path);
}

async function assertDiagrams(page, expected, preview = '#detail-preview') {
  const selector = preview + ' .diagram-image';
  await page.waitForFunction(({selector, count}) => {
    const images = Array.from(document.querySelectorAll(selector));
    return images.length === count && images.every(image => image.complete && image.naturalWidth > 0);
  }, {selector, count: expected.length}, {timeout: 30000});
  const labels = await page.locator(selector).evaluateAll(async images => {
    return Promise.all(images.map(async image => {
      const blob = window.testDiagramBlobs.get(image.src);
      if (!blob) throw new Error('The preview did not generate a local SVG image.');
      const svg = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml');
      if (svg.documentElement.localName !== 'svg') throw new Error('The rendered diagram is not valid SVG.');
      return svg.documentElement.textContent;
    }));
  });
  for (const [index, phrases] of expected.entries()) {
    for (const phrase of phrases) assert.ok(labels[index].includes(phrase), 'Missing diagram label: ' + phrase);
  }
}

async function checkRendering(session) {
  const folder = '오프라인 자료';
  const markdownPath = '그림/기록.md';
  const png = Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
  const markdown = [
    '#기록 **보관**',
    '',
    '**중요한 기록**과 `보기()`를 확인한다.',
    '',
    '- 첫째 문서',
    '- 둘째 문서',
    '',
    '######작은 제목',
    '',
    fence('text', '#코드 속 기호'),
    '',
    '[외부 자료](https://example.invalid/reference)',
    '',
    '| 항목 | 값 |',
    '| --- | --- |',
    '| 기록 | 둘 |',
    '',
    '![로컬 표지](../' + encodeURIComponent('표지 그림.png') + '?v=2#preview)',
    '![폴더 밖 표지](../../탈출.png)',
    '![외부 표지](https://example.invalid/cover.png)',
    '![확장자만 PNG](가짜.png)',
    '',
    '[원시 파일](../원시.txt#preview)',
    '',
    fence('mermaid', flowchart),
    '',
    fence('mermaid', mermaidSequence),
    '',
    fence('plantuml', plantumlSequence),
    '',
    fence('plantuml', plantumlClass),
    '',
    fence('mermaid', 'flowchart TD\n  A --> ['),
    '',
    '## 다이어그램 아래 문장'
  ].join('\n');
  const plain = '# 그대로 보는 텍스트\n**굵게 표시하지 않는 문장**';
  const page = await session.context.newPage();
  try {
    await page.addInitScript(() => {
      window.testDiagramBlobs = new Map();
      const createObjectURL = URL.createObjectURL;
      URL.createObjectURL = function (blob) {
        const url = createObjectURL.call(this, blob);
        if (blob.type.startsWith('image/svg+xml')) window.testDiagramBlobs.set(url, blob);
        return url;
      };
    });
    await session.context.setOffline(true);
    await page.goto(session.home + '?date=2031-05-12#journal');
    await page.locator('#choose-first-folder').waitFor();
    await page.evaluate(async ({folder, files, png}) => {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle(folder, {create: true});
      const nested = await directory.getDirectoryHandle('그림', {create: true});
      const write = async (parent, name, data) => {
        const handle = await parent.getFileHandle(name, {create: true});
        const writer = await handle.createWritable();
        await writer.write(data);
        await writer.close();
      };
      for (const [name, text] of Object.entries(files)) {
        await write(name.includes('/') ? nested : directory, name.split('/').pop(), text);
      }
      await write(directory, '표지 그림.png', Uint8Array.from(png));
      await write(root, '탈출.png', Uint8Array.from(png));
    }, {folder, png, files: {
      [markdownPath]: markdown,
      '그림/목차.markdown': '# 문서 목차',
      '원시.txt': plain,
      '그림/흐름.mmd': flowchart,
      '그림/흐름.mermaid': flowchart,
      '그림/구조.puml': plantumlClass,
      '그림/구조.plantuml': plantumlClass,
      '그림/가짜.png': '<svg xmlns="http://www.w3.org/2000/svg"/>'
    }});
    await selectFolder(page, folder);
    await page.locator('#memo-input').fill('#111');
    await page.locator('#memo-save').click();
    await page.locator('#detail-preview').getByRole('heading', {name: '111', exact: true, level: 1}).waitFor();
    await page.locator('#archive-list .archive-text').getByText('111', {exact: true}).waitFor();
    await page.locator('#toggle-document-source').click();
    assert.equal(await page.locator('#detail-original:visible').innerText(), '#111');
    const fileName = await page.locator('#detail-path').innerText();
    const saved = await page.evaluate(async ({folder, fileName}) => {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle(folder);
      const handle = await directory.getFileHandle(fileName);
      return (await handle.getFile()).text();
    }, {folder, fileName});
    assert.equal(saved, '#111');
    await openSource(page, '그림/목차.markdown');
    await page.locator('#detail-preview').getByRole('heading', {name: '문서 목차', level: 1}).waitFor();
    await openSource(page, markdownPath);
    const preview = page.locator('#detail-preview');
    await preview.getByRole('heading', {name: '기록 보관', level: 1}).waitFor();
    assert.equal(await preview.locator('h1 strong').textContent(), '보관');
    assert.equal(await preview.locator('p strong').textContent(), '중요한 기록');
    await preview.getByRole('heading', {name: '작은 제목', level: 6}).waitFor();
    assert.equal(await preview.locator('pre code').first().textContent(), '#코드 속 기호\n');
    assert.deepEqual(await preview.locator('ul > li').allTextContents(), ['첫째 문서', '둘째 문서']);
    assert.deepEqual(await preview.locator('table th').allTextContents(), ['항목', '값']);
    assert.deepEqual(await preview.locator('table td').allTextContents(), ['기록', '둘']);
    assert.equal(await preview.locator('p code').textContent(), '보기()');
    const external = preview.getByRole('link', {name: '외부 자료'});
    assert.equal(await external.getAttribute('target'), '_blank');
    assert.equal(await external.getAttribute('rel'), 'noopener noreferrer');
    await page.waitForFunction(() => {
      const image = document.querySelector('#detail-preview img[alt="로컬 표지"]');
      return image?.complete && image.naturalWidth > 0 && image.src.startsWith('blob:');
    });
    for (const alt of ['폴더 밖 표지', '외부 표지', '확장자만 PNG']) {
      await preview.locator('.markdown-image-alt').getByText(alt, {exact: true}).waitFor();
      assert.equal(await preview.locator(`img[alt="${alt}"]`).count(), 0);
    }
    const assetPaths = await page.evaluate(async markdownPath => {
      const {resolveMarkdownPath} = await import('./ui/markdown-assets.js');
      return ['../%ED%91%9C%EC%A7%80%20%EA%B7%B8%EB%A6%BC.png', '../../탈출.png',
        '/절대.png', '//외부서버/그림.png', 'file:///그림.png', '%2F절대.png', '%5C절대.png',
        '%00그림.png', '..%2F..%2F탈출.png', '%FF그림.png'].map(href => resolveMarkdownPath(markdownPath, href));
    }, markdownPath);
    assert.deepEqual(assetPaths, ['표지 그림.png', ...Array(9).fill(null)]);
    const diagramLabels = [
      ['자료 접수', '분류 완료'],
      ['독자', '서점원', '책을 물어봄'],
      ['기록자', '동료', '기록을 보냄'],
      ['자료함', '책갈피']
    ];
    await assertDiagrams(page, diagramLabels);
    // A failed diagram names the failing line and keeps the engine's report.
    await preview.locator('.diagram-status:visible').getByText('Mermaid 2번째 줄을 해석하지 못했습니다.', {exact: true}).waitFor();
    assert.match(await preview.locator('.diagram-error:visible').last().textContent(), /Parse error on line 2:[\s\S]*Expecting/);
    assert.match(await preview.locator('.diagram-source:visible').last().textContent(), /A --> \[/);
    await preview.getByRole('heading', {name: '다이어그램 아래 문장', level: 2}).waitFor();
    console.log('PASS  offline Markdown and Korean Mermaid and PlantUML diagrams with malformed fallback');

    const raw = page.locator('#detail-original');
    await page.locator('#toggle-document-source').click();
    await raw.waitFor();
    assert.equal(await raw.textContent(), markdown);
    await page.locator('#toggle-document-source').click();
    await preview.waitFor();

    await preview.getByRole('button', {name: '원시 파일'}).click();
    await raw.waitFor();
    assert.equal(await raw.textContent(), plain);
    assert.equal(await preview.isVisible(), false);

    await openSection(page, 'folder-files');
    for (const [path, source, labels] of [
      ['그림/흐름.mmd', flowchart, diagramLabels[0]],
      ['그림/흐름.mermaid', flowchart, diagramLabels[0]],
      ['그림/구조.puml', plantumlClass, diagramLabels[3]],
      ['그림/구조.plantuml', plantumlClass, diagramLabels[3]]
    ]) {
      await page.locator('#file-list').getByRole('button', {name: path, exact: true}).click();
      await page.locator('#file-preview:visible').waitFor();
      await assertDiagrams(page, [labels], '#file-preview');
      await page.locator('#toggle-file-source').click();
      assert.equal(await page.locator('#file-content:visible').textContent(), source);
      await page.locator('#file-close').click();
    }
    await page.locator('#file-list').getByRole('button', {name: markdownPath, exact: true}).click();
    await page.locator('#file-preview').getByRole('heading', {name: '기록 보관', level: 1}).waitFor();
    assert.equal(await page.locator('#file-preview li').count(), 2);
    await assertDiagrams(page, diagramLabels, '#file-preview');
    await page.locator('#toggle-file-source').click();
    assert.equal(await page.locator('#file-content:visible').textContent(), markdown);
    await page.locator('#open-file-memo').click();
    await preview.getByRole('heading', {name: '기록 보관', level: 1}).waitFor();

    await openSource(page, '그림/흐름.mmd');
    await assertDiagrams(page, [['자료 접수', '분류 완료']]);
    await openSource(page, '그림/구조.puml');
    await assertDiagrams(page, [['자료함', '책갈피']]);

    await openSource(page, markdownPath);
    await page.locator('#edit-memo').click();
    const editor = page.locator('#edit-input');
    assert.equal(await editor.inputValue(), markdown);
    await editor.fill('# 수정한 기록\n\n' + fence('mermaid', flowchart.replace('분류 완료', '검토 끝')));
    await page.locator('#edit-save').click();
    await preview.getByRole('heading', {name: '수정한 기록', level: 1}).waitFor();
    await assertDiagrams(page, [['자료 접수', '검토 끝']]);
    console.log('PASS  standalone diagrams, exact text source, and rendered edits');

    // The memo field stays one row, keeps typed and filled line breaks, and saves on Enter.
    const memoInput = page.locator('#memo-input');
    await memoInput.fill('   \n');
    await memoInput.press('Enter');
    await page.locator('#home-status').getByText('내용을 적어 주세요.').waitFor();
    await memoInput.fill('');
    await page.keyboard.type('    첫 줄');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('둘째 줄');
    await page.keyboard.press('Shift+Enter');
    const exactSource = '    첫 줄\n둘째 줄\n';
    assert.equal(await memoInput.inputValue(), exactSource);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#detail-path').textContent.startsWith('첫 줄-'));
    assert.equal(await memoInput.inputValue(), '');
    assert.equal(await raw.textContent(), exactSource);
    // A pasted diagram source becomes a .puml or .mmd file and renders without a code fence.
    const diskFile = path => page.evaluate(async ({folder, path}) => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(folder);
      return (await (await directory.getFileHandle(path)).getFile()).text();
    }, {folder, path});
    assert.equal(await diskFile(await page.locator('#detail-path').innerText()), exactSource);
    for (const [source, extension, labels] of [
      [plantumlSequence, 'puml', diagramLabels[2]],
      [mermaidSequence, 'mmd', diagramLabels[1]]
    ]) {
      await memoInput.fill(source);
      await memoInput.press('Enter');
      await page.waitForFunction(extension => /^다이어그램-[0-9a-f]{8}\.(\w+)$/.exec(
        document.querySelector('#detail-path').textContent)?.[1] === extension, extension);
      await assertDiagrams(page, [labels]);
      assert.equal(await diskFile(await page.locator('#detail-path').innerText()), source);
    }
    // Declarations glued onto one line fail with the line, its text and PlantUML's verdict.
    await memoInput.fill('@startuml\nparticipant 기록자 as Foo actor 동료 as Foo1 Foo -> Foo1 : 보냄\n@enduml');
    await memoInput.press('Enter');
    await preview.locator('.diagram-status:visible').getByText(
      'PlantUML 2번째 줄을 해석하지 못했습니다. 선언과 메시지를 한 줄에 하나씩 적었는지 확인해 주세요.', {exact: true}).waitFor();
    assert.equal(await preview.locator('.diagram-error:visible').textContent(),
      '2 | participant 기록자 as Foo actor 동료 as Foo1 Foo -> Foo1 : 보냄\nSyntax Error? (Assumed diagram type: sequence)');
    // A bare fence counts lines from its own first line, not the @startuml this app adds.
    const bare = await page.evaluate(async () => {
      const {renderPlantuml} = await import('./ui/plantuml.js');
      try { await renderPlantuml('Alice -> Bob : 인사\nclass A {'); return 'rendered'; } catch (error) { return error.message; }
    });
    assert.match(bare, /^PlantUML 2번째 줄을 해석하지 못했습니다/);
    // A Markdown memo whose whole text is a diagram renders as that diagram.
    await openSource(page, fileName);
    await page.locator('#edit-memo').click();
    await editor.fill(plantumlClass);
    await page.locator('#edit-save').click();
    await assertDiagrams(page, [diagramLabels[3]]);
    assert.equal(await diskFile(fileName), plantumlClass);
    const detected = await page.evaluate(async () => {
      const {detectFormat} = await import('./documents.js');
      return ['graph 공부하기\n내일 다시', 'timeline', 'timeline\n  2031 : 개점', '@startuml\nA -> B', '%% 메모\ngraph LR\n  A --> B']
        .map(detectFormat);
    });
    assert.deepEqual(detected, ['markdown', 'markdown', 'mermaid', 'markdown', 'mermaid']);
    console.log('PASS  multi-line memo field, diagram file extensions and whole-diagram Markdown');

    // Replies take several lines and render Markdown and diagrams, each in its own preview.
    const replyInput = page.locator('#reply-input');
    await replyInput.click();
    // Windows Chrome sends Shift+Enter after a Korean syllable only as a composing keydown;
    // its line break must survive, while a composing plain Enter must not save.
    const composingEnter = (selector, shiftKey) => page.locator(selector).evaluate((input, shiftKey) =>
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true,
        shiftKey, bubbles: true, cancelable: true})), shiftKey);
    assert.equal(await composingEnter('#reply-input', true), true);
    assert.equal(await composingEnter('#reply-input', false), false);
    await page.keyboard.type('**굵은** 답장');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('- 항목');
    await page.keyboard.press('Enter');
    const replyArticle = text => page.locator('#detail-replies article').filter({hasText: text});
    await replyArticle('항목').locator('.reply-preview strong').getByText('굵은', {exact: true}).waitFor();
    assert.deepEqual(await replyArticle('항목').locator('.reply-preview li').allTextContents(), ['항목']);
    assert.equal(await replyArticle('항목').locator('.reply-original').isVisible(), false);
    await replyArticle('항목').locator('.reply-source-toggle').click();
    assert.equal(await replyArticle('항목').locator('.reply-original').textContent(), '**굵은** 답장\n- 항목');
    await replyArticle('항목').locator('.reply-source-toggle').click();
    await replyInput.fill(mermaidSequence);
    await replyInput.press('Enter');
    await assertDiagrams(page, [diagramLabels[1]], '#detail-replies');
    await assertDiagrams(page, [diagramLabels[3]]);
    await replyInput.fill('그냥 한 줄 답장');
    await replyInput.press('Enter');
    const plainReply = replyArticle('그냥 한 줄 답장');
    await plainReply.locator('.reply-original:visible').waitFor();
    assert.equal(await plainReply.locator('.reply-source-toggle').isVisible(), false);
    assert.equal(await plainReply.locator('.reply-preview').textContent(), '');
    const storedReplies = JSON.parse(await diskFile('jjokmun-vault.json')).payload.state.memos
      .flatMap(memo => memo.replies.map(reply => reply.text));
    assert.ok(storedReplies.includes('**굵은** 답장\n- 항목'));
    assert.ok(storedReplies.includes(mermaidSequence));
    // The edit dialog keeps line breaks typed with Shift+Enter and still saves on Enter.
    await replyArticle('항목').locator('[data-action="edit"]').click();
    const replyEditor = page.locator('#reply-edit-input');
    assert.equal(await replyEditor.inputValue(), '**굵은** 답장\n- 항목');
    assert.equal(await composingEnter('#reply-edit-input', true), true);
    assert.equal(await composingEnter('#reply-edit-input', false), false);
    await replyEditor.fill('수정한 답장');
    await replyEditor.press('Shift+Enter');
    await replyEditor.press('End');
    await page.keyboard.type('둘째 줄');
    await replyEditor.press('Enter');
    await page.locator('#detail-status').getByText('답장을 수정했어요.', {exact: true}).waitFor();
    assert.equal(await replyArticle('둘째 줄').locator('.reply-original:visible').textContent(), '수정한 답장\n둘째 줄');
    const accepted = await page.evaluate(async () => {
      const {validateBackup} = await import('./store.js');
      const state = {version: 1, daily: [], props: [], memos: [{id: 'm', text: '메모', createdOn: '2031-05-11', updatedAt: 1,
        replies: [{id: 'r', text: '첫 줄\n둘째 줄', createdOn: '2031-05-11', createdAt: 1}]}]};
      return validateBackup(state).memos[0].replies[0].text;
    });
    assert.equal(accepted, '첫 줄\n둘째 줄');
    // The fields stop at the stored limit, so a saved reply never makes the vault unreadable.
    const limits = await page.evaluate(async () => {
      const {REPLY_LIMIT} = await import('./store.js');
      return ['reply-input', 'reply-edit-input'].map(id => document.getElementById(id).maxLength === REPLY_LIMIT);
    });
    assert.deepEqual(limits, [true, true]);
    console.log('PASS  multi-line replies with per-reply Markdown and diagram previews, edit dialog and backup validation');

    // Queue a Markdown render and immediately switch to a standalone diagram.
    await page.evaluate(markdownPath => {
      const rows = Array.from(document.querySelectorAll('#archive-list button'));
      const row = path => rows.find(row => row.querySelector('.archive-path')?.textContent === path);
      row('원시.txt').click();
      row(markdownPath).click();
      row('그림/구조.puml').click();
    }, markdownPath);
    await page.waitForFunction(() => document.querySelector('#detail-path').textContent === '그림/구조.puml');
    await assertDiagrams(page, [['자료함', '책갈피']]);
    assert.equal(await preview.getByRole('heading', {name: '수정한 기록'}).count(), 0);

    const password = 'test-only rendering vault password';
    await seedEncryptedVault(page, password);
    await page.evaluate(async () => {
      const {lockVault} = await import('./vault.js');
      await lockVault();
      window.dispatchEvent(new Event('focus'));
    });
    await page.locator('#lock-screen').waitFor();
    assert.equal(await preview.textContent(), '');
    assert.equal(await raw.textContent(), '');
    assert.equal(await preview.locator('.diagram-image').count(), 0);
    assert.deepEqual(session.external, []);
    console.log('PASS  preview switches and locking discard rendered source with network disabled');
  } finally {
    await page.close();
    await session.context.setOffline(false);
  }
}

module.exports = {checkRendering};
