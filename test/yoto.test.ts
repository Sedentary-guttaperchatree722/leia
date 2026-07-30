import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { YotoApiError, YotoClient } from '../src/yoto.ts'

test('authenticates API requests and reads upload details', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch
  let requestedUrl = ''
  let authorization: string | null = null

  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input)
    authorization = new Headers(init?.headers).get('Authorization')
    return new Response(JSON.stringify({ upload: { uploadUrl: 'https://upload.example/file', uploadId: 'upload-1' } }))
  }

  try {
    const client = new YotoClient(async () => 'token-1')
    assert.deepEqual(await client.getAudioUploadUrl(), {
      uploadUrl: 'https://upload.example/file',
      uploadId: 'upload-1',
    })
    assert.equal(requestedUrl, 'https://api.yotoplay.com/media/transcode/audio/uploadUrl')
    assert.equal(authorization, 'Bearer token-1')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('does not send the bearer token to a presigned upload URL', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch
  const directory = await mkdtemp(path.join(tmpdir(), 'leia-test-'))
  const file = path.join(directory, 'audio.mp3')
  await writeFile(file, 'audio')
  let authorization: string | null = 'not checked'

  globalThis.fetch = async (_input, init) => {
    authorization = new Headers(init?.headers).get('Authorization')
    return new Response(null, { status: 200 })
  }

  try {
    const client = new YotoClient(async () => 'token-1')
    await client.putAudio('https://upload.example/file', file)
    assert.equal(authorization, null)
  } finally {
    globalThis.fetch = originalFetch
    await rm(directory, { recursive: true, force: true })
  }
})

test('preserves useful API failures', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('permission denied', { status: 403 })

  try {
    const client = new YotoClient(async () => 'token-1')
    await assert.rejects(client.getAudioUploadUrl(), (error: unknown) => {
      assert.ok(error instanceof YotoApiError)
      assert.equal(error.status, 403)
      assert.equal(error.body, 'permission denied')
      return true
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
