export const BACKUP_FORMAT = 'memo-alley-encrypted';
// The on-disk backup includes the base64 encoding of an encrypted payload.
export const MAX_VAULT_BYTES = 32 * 1024 * 1024;
export const MAX_BACKUP_BYTES = 48 * 1024 * 1024;
const ITERATIONS = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function encode(bytes) {
  if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 24_576) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24_576))));
  }
  return chunks.join('');
}

function decode(value, size, limit = size) {
  if (typeof value !== 'string' || value.length > Math.ceil(limit / 3) * 4
      || value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value)
      || (value.includes('=') && !/^={1,2}$/.test(value.slice(value.indexOf('='))))) {
    throw new Error('암호화 데이터의 형식이 올바르지 않습니다.');
  }
  const bytes = typeof Uint8Array.fromBase64 === 'function'
    ? Uint8Array.fromBase64(value, { lastChunkHandling: 'strict' })
    : Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  if (bytes.length < size || bytes.length > limit) throw new Error('암호화 데이터의 크기가 올바르지 않습니다.');
  return bytes;
}

export function newSalt() {
  return encode(crypto.getRandomValues(new Uint8Array(16)));
}

export async function deriveKey(password, salt) {
  const bytes = encoder.encode(password);
  try {
    const baseKey = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({
      name: 'PBKDF2',
      salt: decode(salt, 16),
      iterations: ITERATIONS,
      hash: 'SHA-256'
    }, baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally {
    bytes.fill(0);
  }
}

export function requireNewPassword(password) {
  if (password.length < 8 || password.length > 256) throw new Error('비밀번호는 8~256자로 입력해 주세요.');
}

function cipherOptions(purpose, salt, iv) {
  return { name: 'AES-GCM', iv, additionalData: encoder.encode('memo-alley:' + purpose + ':1:' + salt) };
}

export async function seal(value, key, salt, purpose) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = encoder.encode(JSON.stringify(value));
  try {
    if (bytes.byteLength + 16 > MAX_VAULT_BYTES) throw new Error('암호화할 기록이 저장 가능한 크기를 넘었습니다.');
    const ciphertext = await crypto.subtle.encrypt(cipherOptions(purpose, salt, iv), key, bytes);
    return { salt, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
  } finally {
    bytes.fill(0);
  }
}

export async function unseal(envelope, key, purpose) {
  const iv = decode(envelope.iv, 12);
  const ciphertext = decode(envelope.ciphertext, 16, MAX_VAULT_BYTES);
  let clear;
  try {
    clear = new Uint8Array(await crypto.subtle.decrypt(cipherOptions(purpose, envelope.salt, iv), key, ciphertext));
  } catch {
    throw new Error('비밀번호가 일치하지 않거나 암호화 데이터가 손상되었습니다.');
  }
  try {
    return JSON.parse(decoder.decode(clear));
  } finally {
    clear.fill(0);
  }
}

export async function encryptBackup(state, password) {
  requireNewPassword(password);
  const salt = newSalt();
  const key = await deriveKey(password, salt);
  return { format: BACKUP_FORMAT, version: 1, ...await seal(state, key, salt, 'backup') };
}

export async function decryptBackup(envelope, password) {
  if (envelope.version !== 1 || !password || password.length > 256) throw new Error('백업 버전이나 비밀번호 형식을 확인해 주세요.');
  decode(envelope.iv, 12);
  decode(envelope.ciphertext, 16, MAX_VAULT_BYTES);
  const key = await deriveKey(password, envelope.salt);
  return unseal(envelope, key, 'backup');
}
