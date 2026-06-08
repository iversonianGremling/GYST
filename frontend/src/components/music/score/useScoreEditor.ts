// Editor state for one score: the live doc, an undo/redo history, mutation
// helpers, and debounced autosave to the backend. Instance-scoped (no globals)
// so multiple editors never collide.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import { ScoreDoc, ScoreNote, Track, uid } from './types'

const MAX_HISTORY = 100

export interface ScoreEditorApi {
  doc: ScoreDoc
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
  /** Replace the whole doc, pushing the previous one onto the undo stack. */
  commit: (next: ScoreDoc | ((d: ScoreDoc) => ScoreDoc)) => void
  /** Convenience mutators over track `ti` (default 0). */
  addNote: (note: Omit<ScoreNote, 'id'>, ti?: number) => string
  updateNote: (id: string, patch: Partial<ScoreNote>, ti?: number) => void
  removeNotes: (ids: string[], ti?: number) => void
  setTempo: (bpm: number) => void
  setInstrument: (instrument: string, ti?: number) => void
  undo: () => void
  redo: () => void
}

function mapTrack(doc: ScoreDoc, ti: number, fn: (t: Track) => Track): ScoreDoc {
  return { ...doc, tracks: doc.tracks.map((t, i) => (i === ti ? fn(t) : t)) }
}

export function useScoreEditor(scoreId: string, initial: ScoreDoc): ScoreEditorApi {
  const [doc, setDoc] = useState<ScoreDoc>(initial)
  const [dirty, setDirty] = useState(false)
  const past = useRef<ScoreDoc[]>([])
  const future = useRef<ScoreDoc[]>([])
  const [version, setVersion] = useState(0) // forces re-render when stacks change

  const commit = useCallback((next: ScoreDoc | ((d: ScoreDoc) => ScoreDoc)) => {
    setDoc((prev) => {
      const resolved = typeof next === 'function' ? (next as (d: ScoreDoc) => ScoreDoc)(prev) : next
      if (resolved === prev) return prev
      past.current.push(prev)
      if (past.current.length > MAX_HISTORY) past.current.shift()
      future.current = []
      return resolved
    })
    setDirty(true)
    setVersion((v) => v + 1)
  }, [])

  const addNote = useCallback(
    (note: Omit<ScoreNote, 'id'>, ti = 0): string => {
      const id = uid('n')
      commit((d) => mapTrack(d, ti, (t) => ({ ...t, notes: [...t.notes, { ...note, id }] })))
      return id
    },
    [commit],
  )

  const updateNote = useCallback(
    (id: string, patch: Partial<ScoreNote>, ti = 0) => {
      commit((d) =>
        mapTrack(d, ti, (t) => ({
          ...t,
          notes: t.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
        })),
      )
    },
    [commit],
  )

  const removeNotes = useCallback(
    (ids: string[], ti = 0) => {
      const set = new Set(ids)
      commit((d) => mapTrack(d, ti, (t) => ({ ...t, notes: t.notes.filter((n) => !set.has(n.id)) })))
    },
    [commit],
  )

  const setTempo = useCallback(
    (bpm: number) => commit((d) => ({ ...d, tempo: Math.max(20, Math.min(300, Math.round(bpm))) })),
    [commit],
  )

  const setInstrument = useCallback(
    (instrument: string, ti = 0) => commit((d) => mapTrack(d, ti, (t) => ({ ...t, instrument }))),
    [commit],
  )

  const undo = useCallback(() => {
    setDoc((prev) => {
      if (!past.current.length) return prev
      const last = past.current.pop()!
      future.current.unshift(prev)
      return last
    })
    setDirty(true)
    setVersion((v) => v + 1)
  }, [])

  const redo = useCallback(() => {
    setDoc((prev) => {
      if (!future.current.length) return prev
      const next = future.current.shift()!
      past.current.push(prev)
      return next
    })
    setDirty(true)
    setVersion((v) => v + 1)
  }, [])

  // Debounced autosave.
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => {
      api
        .put(`/plugins/music-project/score/${scoreId}`, { doc })
        .then(() => setDirty(false))
        .catch(() => {
          /* keep dirty; will retry on next change */
        })
    }, 800)
    return () => clearTimeout(t)
  }, [doc, dirty, scoreId])

  // `version` bumps on every history change, forcing a re-render so the
  // ref-derived canUndo/canRedo below are read fresh.
  void version

  return {
    doc,
    dirty,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    commit,
    addNote,
    updateNote,
    removeNotes,
    setTempo,
    setInstrument,
    undo,
    redo,
  }
}
