import { element, memoExcerpt } from './dom.js';

// Each response is the reader's own association with a word on the page.
const associations = [
  {
    words: /연필|그림|스케치|그리기/,
    reaction: '저도 손이 근질거려요. 첫 장에는 제 연필을 그려 볼래요.',
    drawing: '연두가 몽당연필을 그린 첫 장을 펼칩니다. 그 옆에 지난번 글이 끼워져 있어요.',
    question: '그날 이후에도 다시 그려 본 게 있나요?'
  },
  {
    words: /걷기|산책|걸음|운동화/,
    reaction: '저도 밖에 나가 볼래요. 오늘은 골목에서 처음 눈에 띄는 걸 하나만 그려 볼게요.',
    drawing: '연두가 골목에서 만난 고양이를 그려 왔어요. 그림 밑에 지난번 글이 꽂혀 있습니다.',
    question: '그 뒤로 걷다가 새로 눈에 들어온 게 있나요?'
  },
  {
    words: /실패|망쳤|틀렸|실수/,
    reaction: '저는 선 하나만 삐뚤어져도 종이를 뜯어냈거든요. 오늘은 그 선도 남겨 둘래요.',
    drawing: '연두가 비뚤어진 선에 돛을 그려 넣은 종이배를 보여 줍니다. 옆장에는 지난번 글이 있어요.',
    question: '다시 해 본 날도, 잠시 쉬었던 날도 궁금해요. 그 뒤엔 어땠어요?'
  }
];
const firstPage = {
  reaction: '빈 종이를 보면서 완성할 그림만 생각했어요. 오늘은 첫 장에 날짜부터 써 볼래요.',
  drawing: '연두가 지난번 글을 꺼내며 스케치북을 보여 줍니다. 날짜 아래에 작은 찻잔이 하나 그려져 있어요.',
  question: '이 글에 적은 날 다음에는 무슨 일이 있었어요?'
};

export function bindGuestVisit() {
  let openedOn;
  let returningMemoId;
  let previousStage;
  function reset() {
    openedOn = returningMemoId = previousStage = undefined;
    for (const id of ['guest-page', 'guest-reaction', 'guest-status', 'guest-speech']) element(id).textContent = '';
    element('guest-input').value = '';
  }

  function render(state, date) {
    const memo = state.memos.find(note => note.id === state.shop?.guestMemoId);
    // A new page or a new day is a visit. Background saves and focus events are not.
    if (openedOn !== date) returningMemoId = memo?.id;
    openedOn = date;
    if (!memo) returningMemoId = undefined;
    const reply = memo?.replies.find(item => item.id === state.shop.guestReplyId);
    const returning = Boolean(memo && memo.id === returningMemoId);
    const stage = !memo ? 'request' : reply ? 'answered' : returning ? 'return' : 'received';
    if (previousStage !== stage) {
      element('guest-input').value = '';
      element('guest-status').textContent = '';
      previousStage = stage;
    }
    const excerpt = memo ? memoExcerpt(memo, 500) : '';
    const association = memo && (associations.find(item => item.words.test(memo.text)) || firstPage);
    const title = element('writing-title');
    const speech = element('guest-speech');
    const reaction = element('guest-reaction');
    const page = element('guest-page');
    page.hidden = !memo;
    page.textContent = excerpt;
    reaction.hidden = !memo;
    element('guest-form').hidden = Boolean(memo && (!returning || reply));
    element('guest-choose').hidden = Boolean(memo) || !state.memos.length;
    element('give-memo').hidden = Boolean(memo);
    element('guest-label').textContent = returning ? '그날 이후의 이야기' : '연두에게 건넬 한 줄';
    element('guest-submit').textContent = returning ? '뒷이야기 건네기' : '글 건네기';
    if (!memo) {
      title.textContent = '첫 장을 펴는 용기';
      speech.textContent = '“스케치북을 산 지 한 달인데 첫 장이 아직 하얘요. 망설이다가 뭔가 시작했던 날이 있나요? 그날 이야기를 한 줄만 읽고 싶어요.”';
      reaction.textContent = '';
    } else if (reply) {
      title.textContent = '스케치북에 끼운 두 번째 쪽지';
      speech.textContent = '연두의 스케치북에는 처음 건넨 글과 그 뒤에 들려준 이야기가 나란히 꽂혀 있어요.';
      reaction.textContent = '“' + reply.text + '”';
    } else if (returning) {
      title.textContent = '그 뒤에는 어땠어요?';
      speech.textContent = association.drawing;
      reaction.textContent = '“' + association.question + '”';
    } else {
      title.textContent = '연두가 첫 장을 펼칩니다';
      speech.textContent = '연두가 건네받은 글을 소리 내어 읽습니다.';
      reaction.textContent = '“' + association.reaction + ' 다음에 오면 뒷이야기도 들려주세요.”';
    }
  }
  return { render, reset };
}
