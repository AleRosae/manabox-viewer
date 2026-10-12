/**
 * Moxfield decks reach the app through a bookmarklet: Moxfield rejects requests from our server
 * (Cloudflare), but a page of moxfield.com can read its own API. The bookmarklet reads the deck,
 * copies it to the clipboard (while the Moxfield tab still has the focus), then opens the app's
 * receiving page and posts the deck to it; the clipboard is for when the browser cuts the link
 * between the two windows.
 */

import type { MoxfieldDeck } from './types'

export const RECEIVER_PATH = '/decks/moxfield-sync'
export const READY_MESSAGE = 'mbv-moxfield-ready'
export const DECK_MESSAGE = 'mbv-moxfield-deck'
export const MOXFIELD_ORIGIN = /^https:\/\/(www\.)?moxfield\.com$/

export const deckUrl = (id: string) => `https://moxfield.com/decks/${id}`

/** The bookmarklet's code for an app served at `appOrigin`. */
export function bookmarklet(appOrigin: string): string {
  const app = JSON.stringify(appOrigin)
  const code = `(async()=>{
const APP=${app};
const m=location.pathname.match(/\\/decks\\/([^/?#]+)/);
if(!/(^|\\.)moxfield\\.com$/.test(location.hostname)||!m){alert('ManaBox Viewer: open a Moxfield deck first');return}
try{
const r=await fetch('https://api2.moxfield.com/v3/decks/all/'+m[1]);
if(!r.ok)throw new Error('Moxfield answered '+r.status);
const d=await r.json();
const boards={};
for(const[b,v]of Object.entries(d.boards||{}))boards[b]=Object.values(v.cards||{}).map(c=>({scryfall_id:c.card.scryfall_id||null,name:c.card.name,quantity:c.quantity,set:c.card.set||null,cn:c.card.cn||null}));
const deck={id:d.publicId||m[1],name:d.name||'Moxfield deck',format:d.format||null,boards};
addEventListener('message',e=>{if(e.origin===APP&&e.data==='${READY_MESSAGE}')e.source.postMessage({type:'${DECK_MESSAGE}',deck},APP)});
try{await navigator.clipboard.writeText(JSON.stringify(deck))}catch(_){}
window.open(APP+'${RECEIVER_PATH}','mbv-moxfield');
}catch(e){alert('ManaBox Viewer: '+e.message)}
})()`
  return 'javascript:' + encodeURIComponent(code.replace(/\n/g, ''))
}

/** A deck from the bookmarklet (posted or pasted), or null when `value` is something else. */
export function asDeck(value: unknown): MoxfieldDeck | null {
  if (!value || typeof value !== 'object') return null
  const d = value as Partial<MoxfieldDeck>
  if (typeof d.id !== 'string' || !d.boards || typeof d.boards !== 'object') return null
  return { id: d.id, name: typeof d.name === 'string' ? d.name : 'Moxfield deck', format: typeof d.format === 'string' ? d.format : null, boards: d.boards }
}

/** A deck pasted as the bookmarklet's JSON; null for anything else (e.g. a text export). */
export function parseDeckJson(text: string): MoxfieldDeck | null {
  if (!text.trim().startsWith('{')) return null
  try {
    return asDeck(JSON.parse(text))
  } catch {
    return null
  }
}
