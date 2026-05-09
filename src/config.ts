/**
 * 설정 및 상수 관리
 */

// 환경 변수 검증 및 초기화
export function validateEnvironment() {
  const requiredVars = ['DISCORD_TOKEN', 'DATABASE_URL']
  const missing = requiredVars.filter(v => !process.env[v])

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    )
  }
}

export function getEnvironment() {
  validateEnvironment()

  return {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN!,
    DATABASE_URL: process.env.DATABASE_URL!,
    PORT: process.env.PORT || '8000',
    TARGET_CHANNEL_ID: process.env.TARGET_CHANNEL_ID,
    KUROMOJI_DICT_PATH: process.env.KUROMOJI_DICT_PATH
  }
}

// Draw 설정
export const DRAW_CONFIG = {
  DEFAULT_COUNT: 2,
  MIN_COUNT: 1,
  MAX_COUNT: 10,
  BONUS_CHANCE: 0.02,
  BONUS_EXTRA_COUNT: 3,
  BLACKLIST_USER_IDS: new Set(['1238637139856592917'])
} as const

// Auto Draw 설정
export const AUTO_DRAW_CONFIG = {
  DEFAULT_TIME: '20:00',
  TIME_REGEX: /^([01]\d|2[0-3]):([0-5]\d)$/,
  RETRY_MS: 60_000
} as const

// Stats 설정
export const STATS_CONFIG = {
  PAGE_SIZE: 10,
  PARTICIPANT_PAGE_SIZE: 1
} as const

// UI 레이블
export const LABELS = {
  GUILD_ONLY: '서버에서만 사용할 수 있어요.',
  GUILD_UNAVAILABLE: '서버 정보를 가져올 수 없어요. 잠시 후 다시 시도해주세요.',
  OWNER_ONLY: '이 통계는 명령어를 실행한 사람만 조작할 수 있어요.',
  ADMIN_ONLY: '관리자 권한이 필요해요.',
  DATABASE_ERROR: 'DATABASE_URL 설정이 필요해요.',
  PROCESSING_ERROR: '처리 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.',
  INVALID_INPUT: '잘못된 입력이에요. 다시 시도해주세요.',
  INSUFFICIENT_MEMBERS:
    '추첨을 진행하기에 멤버(봇/서버장 제외)가 충분하지 않습니다.',
  DRAW_START: '추첨을 시작합니다...',
  DRAW_ERROR: '추첨 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.'
} as const
