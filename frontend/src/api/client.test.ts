import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fetch globally before importing the client
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Re-import after stubbing
const { api } = await import('./client')

function mockResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers(),
  } as Response)
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('api.get', () => {
  it('sends GET with credentials and returns JSON', async () => {
    mockFetch.mockReturnValueOnce(mockResponse({ id: '1', title: 'Test' }))
    const result = await api.get('/interests/1')
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/interests/1',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(result).toEqual({ id: '1', title: 'Test' })
  })

  it('redirects to /login on 401', async () => {
    Object.defineProperty(window, 'location', { value: { href: '' }, writable: true })
    window.location.href = ''
    mockFetch.mockReturnValueOnce(mockResponse({ detail: 'Unauthorized' }, 401))
    await expect(api.get('/interests')).rejects.toThrow()
    expect(window.location.href).toBe('/login')
  })
})

describe('api.post', () => {
  it('sends POST with JSON body', async () => {
    mockFetch.mockReturnValueOnce(mockResponse({ id: '2' }, 201))
    await api.post('/interests', { title: 'New', kind: 'project' })
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/interests',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: 'New', kind: 'project' }),
      }),
    )
  })

  it('sends POST with no body when body is undefined', async () => {
    mockFetch.mockReturnValueOnce(mockResponse({ ok: true }))
    await api.post('/auth/logout')
    const [, init] = mockFetch.mock.calls[0]
    expect(init.body).toBeUndefined()
  })
})

describe('api.del', () => {
  it('sends DELETE and returns undefined for 204', async () => {
    mockFetch.mockReturnValueOnce(Promise.resolve({ ok: true, status: 204 } as Response))
    const result = await api.del('/interests/1')
    expect(result).toBeUndefined()
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/interests/1',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})

describe('api.patch', () => {
  it('sends PATCH with JSON body', async () => {
    mockFetch.mockReturnValueOnce(mockResponse({ id: '1', title: 'Updated' }))
    await api.patch('/interests/1', { title: 'Updated' })
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/interests/1',
      expect.objectContaining({ method: 'PATCH' }),
    )
  })
})
