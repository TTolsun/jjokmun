# 메모 골목

메모와 답장을 기기에 보관하는 Chrome 확장입니다. 도구 모음의 책 아이콘을 누르면 메모 검색과 편집 화면, 작은 책방이 열립니다.

## 설치와 업데이트

처음 설치할 때는 `chrome://extensions`에서 개발자 모드를 켜고 **압축해제된 확장 프로그램 로드**에서 이 저장소의 `extension` 폴더를 선택하세요.

이미 다른 폴더에서 설치했다면 기존 확장 카드의 **새로고침**으로 업데이트하세요. 압축해제된 확장을 새 경로에서 별도로 로드하면 Chrome이 다른 확장 ID와 저장 공간을 사용할 수 있습니다. 설치 경로를 바꾸려면 먼저 백업을 내보내고, 새 설치에서 메모와 답장이 복원되는지 확인하세요.

잠금, 암호화 백업, 가져오기 되돌리기 방법은 [확장 사용 안내](extension/README.md)에 있습니다.

## 보안 회귀 테스트

Node.js와 Chrome for Testing을 사용합니다. PowerShell에서 이 저장소를 기준으로 실행하세요.

```powershell
cd tests
npm install
npx playwright-core install chromium
npm test
```

이미 Chrome for Testing이 있다면 브라우저 설치 단계 대신 환경 변수 `MEMO_CHROME_PATH`에 실행 파일 경로를 지정할 수 있습니다. 테스트는 임시 Chrome 프로필에 가상 메모를 만들며, 네트워크 차단 검사는 루프백 서버에 접속합니다.
