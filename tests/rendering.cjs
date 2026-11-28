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
    await preview.locator('.diagram-status:visible').first().waitFor();
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
    await memoInput.click();
    await page.keyboard.type('첫 줄');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('둘째 줄');
    assert.equal(await memoInput.inputValue(), '첫 줄\n둘째 줄');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#detail-path').textContent.startsWith('첫 줄-'));
    assert.equal(await memoInput.inputValue(), '');
    assert.equal(await raw.textContent(), '첫 줄\n둘째 줄');
    // A pasted diagram source becomes a .puml or .mmd file and renders without a code fence.
    const diskFile = path => page.evaluate(async ({folder, path}) => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(folder);
      return (await (await directory.getFileHandle(path)).getFile()).text();
    }, {folder, path});
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
    // Single-line fields turn pasted line breaks into spaces instead of gluing words.
    await page.locator('#reply-input').evaluate(input => {
      input.focus();
      input.value = '앞 ';
      input.setSelectionRange(2, 2);
      const data = new DataTransfer();
      data.setData('text/plain', '첫 줄\r\n둘째 줄\n');
      input.dispatchEvent(new ClipboardEvent('paste', {clipboardData: data, bubbles: true, cancelable: true}));
    });
    assert.equal(await page.locator('#reply-input').inputValue(), '앞 첫 줄 둘째 줄');
    await page.locator('#detail-status').getByText('이 칸은 한 줄로 저장돼서 줄바꿈을 띄어쓰기로 바꿨어요.').waitFor();
    await page.locator('#reply-input').fill('');
    console.log('PASS  multi-line memo field, diagram file extensions, whole-diagram Markdown and single-line paste');

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
    await page.evaluate(async password => {
      const {enableVault, lockVault} = await import('./vault.js');
      await enableVault(password);
      await lockVault();
      window.dispatchEvent(new Event('focus'));
    }, password);
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
