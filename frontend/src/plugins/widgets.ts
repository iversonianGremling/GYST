import type { ComponentType } from 'react'
import HelloWorldWidget from './HelloWorldWidget'
import MusicProjectWidget from './MusicProjectWidget'
import RssFeedWidget from './RssFeedWidget'
import LinkwardenWidget from './LinkwardenWidget'

// Static widget registry — add an entry here when a plugin ships a bundled widget.
// Dynamic ESM loading (for out-of-tree plugins) is attempted first in registry.ts;
// this map is the fallback for first-party plugins compiled into the main bundle.
export const STATIC_WIDGETS: Record<string, ComponentType<Record<string, unknown>>> = {
  'hello-world': HelloWorldWidget,
  'music-project': MusicProjectWidget,
  'rss-feed': RssFeedWidget,
  'linkwarden': LinkwardenWidget,
}
