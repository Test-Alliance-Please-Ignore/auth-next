import { readFileSync } from 'fs'
import { createDecipheriv } from 'crypto'

const KEY_HEX = '874525b58d44733106f0f30b1fde86d4b6804ed12394b3e39568f5120facc66a'
const keyBytes = Buffer.from(KEY_HEX, 'hex')

const ciphertext = readFileSync('ciphertext.txt', 'utf8').trim()
console.log('Ciphertext length (chars):', ciphertext.length)

const combined = Buffer.from(ciphertext, 'base64')
console.log('Decoded bytes:', combined.length)

const iv = combined.slice(0, 12)
const authTag = combined.slice(combined.length - 16)
const data = combined.slice(12, combined.length - 16)

console.log('IV (hex):', iv.toString('hex'))
console.log('Auth tag (hex):', authTag.toString('hex'))
console.log('Ciphertext data length:', data.length)

try {
  const decipher = createDecipheriv('aes-256-gcm', keyBytes, iv)
  decipher.setAuthTag(authTag)
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
  console.log('\n✅ Decryption SUCCESS')
  console.log('Plaintext length:', decrypted.length)
  console.log('Plaintext (first 80 chars):', decrypted.toString('utf8').slice(0, 80))
} catch (err) {
  console.error('\n❌ Decryption FAILED:', err.message)

  // Also try Web Crypto style (no separate auth tag extraction — auth tag is last 16 bytes of ciphertext)
  // The Web Crypto API includes the auth tag as the last 16 bytes of the ciphertext output,
  // so combined = IV(12) + ciphertext_with_tag(n+16)
  // Node's createDecipheriv needs auth tag separated, which we did above.
  // Let's also verify if the base64 decoding itself is the issue by trying webcrypto
  console.log('\nTrying with Web Crypto API...')
  try {
    const subtle = globalThis.crypto?.subtle
    if (subtle) {
      const cryptoKey = await subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'])
      const ivWc = combined.slice(0, 12)
      const ciphertextWc = combined.slice(12) // Web Crypto AES-GCM: tag is embedded in ciphertext
      const result = await subtle.decrypt({ name: 'AES-GCM', iv: ivWc }, cryptoKey, ciphertextWc)
      console.log('✅ Web Crypto SUCCESS')
      console.log('Plaintext:', new TextDecoder().decode(result).slice(0, 80))
    } else {
      console.log('Web Crypto not available in this runtime')
    }
  } catch (wcErr) {
    console.error('❌ Web Crypto also FAILED:', wcErr.message)
  }
}
