# Daily Admin Bot

디스코드 서버에서 매일 자동 추첨과 메시지/단어 통계를 제공하는 봇입니다.

## Features

- 매일 `20:00 (Asia/Seoul)` 자동 추첨
- 수동 추첨 명령어 `/추첨` 지원
- `10%` 확률 보너스 이벤트: 자동 추첨 시 `+3명` 추가 당첨
- `/통계` 명령어로 개인/서버 기준 메시지, 단어 통계 조회
- `kuromoji-ko` 기반 한국어 토큰 분석 (실패 시 안전 fallback)
- Koyeb 등 PaaS 배포를 위한 웹 헬스 엔드포인트(`GET /`)

## Commands

- `/추첨`
  - 즉시 추첨 실행
  - 옵션: `인원(1~10)`, `제한1~제한5`(특정 유저만 후보로 제한)
- `/통계`
  - 대상: `개인`, `서버`
  - 기간: `일`, `주`, `월`, `전체`
  - 순위: `10`, `30`, `50`, `100`
- `/추첨설정`
  - 임베드 패널에서 자동추첨 `ON/OFF`, 채널, 시간(`HH:MM`) 설정 후 저장

## Requirements

- Node.js 20+
- PostgreSQL (예: Neon)
- Discord Bot Token

## Discord Bot Setup

1. [Discord Developer Portal](https://discord.com/developers/applications)에서 앱 생성
2. `Bot` 탭에서 봇 추가 후 토큰 발급
3. **Privileged Gateway Intents** 활성화
   - `Server Members Intent`
   - `Message Content Intent`
4. `OAuth2 -> URL Generator`에서
   - Scope: `bot`, `applications.commands`
   - 필요한 권한(예: `Send Messages`) 선택 후 서버 초대

## Environment Variables

`.env` 파일 예시:

```env
DISCORD_TOKEN=your_discord_bot_token
TARGET_CHANNEL_ID=your_channel_id
DATABASE_URL=postgres_connection_string
PORT=8000
# Optional
# KUROMOJI_DICT_PATH=./dict
```

- `DISCORD_TOKEN`: 디스코드 봇 토큰
- `TARGET_CHANNEL_ID`: 자동 추첨 메시지 전송 채널 ID
- `DATABASE_URL`: PostgreSQL 연결 문자열
- `PORT`: 헬스 서버 포트 (기본값 `8000`)
- `KUROMOJI_DICT_PATH`(선택): kuromoji 사전 경로 커스텀
- `TARGET_CHANNEL_ID`(선택): DB 설정이 없을 때만 레거시 기본 자동 추첨 채널로 사용

## Install

```bash
npm install
```

## Run

개발 모드:

```bash
npm run dev
```

빌드 후 실행:

```bash
npm run build
npm start
```

## Deploy (Koyeb)

- Docker 없이 Node 서비스로 배포 가능
- Start Command 예시:

```bash
npm run build && npm start
```

- Koyeb 환경변수에 `.env` 값들을 동일하게 등록
- 배포 후 `/` 엔드포인트 응답(`Discord Bot is alive!`)으로 헬스체크 확인
