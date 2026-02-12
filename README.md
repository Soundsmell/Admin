# Daily Admin Bot

매일 오전 0시(UTC+9)에 서버의 랜덤한 2명의 유저(봇 제외)를 뽑아 메시지를 출력하는 디스코드 봇입니다.

## 사전 준비

1. **Node.js 설치**: [Node.js 공식 홈페이지](https://nodejs.org/)에서 설치해주세요.
2. **디스코드 봇 생성**:
   - [Discord Developer Portal](https://discord.com/developers/applications)에 접속하여 애플리케이션을 생성합니다.
   - 'Bot' 탭에서 봇을 추가합니다.
   - **Privileged Gateway Intents** 항목의 **Server Members Intent**, **Message Content Intent**를 모두 켜주세요.
   - 봇 토큰(Token)을 복사해둡니다.
3. **서버 초대**:
   - 'OAuth2' -> 'URL Generator' 탭으로 이동합니다.
   - 'bot' 및 'applications.commands' 스코프를 체크합니다.
   - 'Send Messages' 등 필요한 권한을 체크합니다.
   - 생성된 URL로 본인의 서버에 봇을 초대합니다.

## 설치 및 설정

1. 패키지 설치:
   ```bash
   npm install
   ```
2. 환경 변수 설정:
   - `.env` 파일을 열고 내용을 수정합니다.
   - `DISCORD_TOKEN`: 위에서 복사한 봇 토큰을 붙여넣습니다.
   - `TARGET_CHANNEL_ID`: 알림을 보낼 채널의 ID를 입력합니다.

## 실행 방법

```bash
npm start
```

## 명령어

- `/draw`: 즉시 랜덤 유저 2명을 추첨하여 메시지를 보냅니다. (봇이 재시작될 때 명령어가 등록됩니다. 등록 완료 로그가 뜨면 사용 가능합니다.)
