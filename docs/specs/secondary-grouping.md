# Spec — Raggruppamento di secondo livello nelle liste

Stato: **approvata, implementata** · Branch: `feature/secondary-grouping`

## Contesto

Oggi la vista *Cards* di un cubo o di un deck ha un solo criterio configurabile, **Group by**
(Color, Type, Mana value, Rarity, Tag), che decide le colonne. Dentro ogni colonna l'ordine è fisso
(`byTypeThenMv`, commit `6daac47`): tipo → mana value → nome.

Quell'ordine rispecchia come Alessandro ha fisicamente organizzato le carte (colore, poi tipo). Chi le
organizza per colore e poi per rarità non può riprodurlo. Inoltre il secondo criterio oggi è
invisibile: le carte sono ordinate per tipo ma non c'è nulla che segnali dove finiscono le creature e
iniziano gli instant.

## Obiettivo

1. Rendere configurabile il criterio di secondo livello, che divide ogni colonna in **sottogruppi**.
2. Rendere visibili i sottogruppi con dei separatori leggeri dentro le colonne, come fa CubeCobra.
3. Lasciare invariato il comportamento di default.

## Modello

| Livello | Cosa decide | Scelte possibili |
|---|---|---|
| 1 · **Group by** | le colonne | Color, Type, Mana value, Rarity, Tag (come oggi) |
| 2 · **Then by** | i sottogruppi dentro la colonna | le stesse del livello 1 **meno quella scelta al livello 1**, più **None** |
| 3 · ordine interno | l'ordine delle carte nel sottogruppo | fisso: mana value, poi nome |

Esempi:
- Alessandro: Color → Type → (MV, nome). È il comportamento attuale.
- Simone: Color → Rarity → (MV, nome).
- Con **None** non ci sono sottogruppi né separatori: la colonna è ordinata solo per MV e nome.

### Default

- Il default di *Then by* è **Type**, così l'ordine di oggi non cambia.
- Se *Group by* è Type (default dei deck), Type non è selezionabile come secondo livello e il default
  diventa **None**: anche questo è identico a oggi (dentro una colonna di tipo l'ordine era già MV → nome).
- Quando cambia *Group by*, *Then by* passa al default del nuovo criterio se era ancora sul default
  del vecchio (es. Type → None diventa Color → Type), o se coincide con il nuovo criterio. Una scelta
  diversa fatta dall'utente resta.

### Persistenza

Oggi *Group by* non viene salvato: si resetta a ogni apertura della lista. Proposta: salvare i due
livelli in `localStorage`, separatamente per cubi e deck (stesso schema di `lastListKey` in
`store/data.ts`). Vale per il browser, non per la singola lista: ognuno ha la sua istanza e il suo
modo di ordinare.

## Regole dei sottogruppi

- Ordine e titoli dei sottogruppi riusano le regole del livello 1 (`order` e `title` in
  `listGroups.ts`): Creature prima e Lands in fondo, rarità da common a mythic, MV da 0 a 7+ e poi Lands,
  tag in ordine alfabetico con *Untagged* in fondo, colori in ordine WUBRG, poi M, C, L.
- Sono mostrati solo i sottogruppi non vuoti.
- **Tag come secondo livello:** una carta con più tag compare in ogni sottogruppo dei suoi tag, come
  già succede al livello 1. Il contatore della colonna la conta una volta sola.
- **Deck:** Commander, Companion, Sideboard e Maybeboard restano una colonna ciascuno, come oggi; il
  secondo livello si applica anche dentro queste colonne. Se *Then by* è None, queste colonne si
  dividono con il criterio di *Group by*, come le colonne del main deck: con il default dei deck
  (Type → None) il sideboard resta diviso per tipo, come prima.
- Il filtro per ownership e quello per tag si applicano prima del raggruppamento, come oggi.

## UI

### Toolbar

Accanto a *Group by* compare un secondo select **Then by**, con le stesse dimensioni e lo stesso stile.
Le opzioni sono *None* più i criteri diversi da quello di *Group by*. È visibile sia nella vista a
colonne sia in quella a immagini.

### Vista a colonne

- Tra un sottogruppo e il successivo c'è una linea sottile (colore `line-2`), senza titolo né
  contatore: il criterio è già scritto nel select *Then by*. Il primo sottogruppo non ha linea sopra,
  perché c'è già l'header della colonna.
- Il resto della colonna non cambia: header con bordo colorato, contatore, "€ to complete", righe.

### Vista a immagini

Dentro ogni sezione, la stessa linea sottile separa le griglie di immagini dei sottogruppi.

## Impatto sul codice

- `lib/listGroups.ts`
  - `ItemGroup` sostituisce `items` con `subgroups: ItemSubgroup[]` (`key`, `items`). Contatori e
    "€ to complete" contano ogni carta una volta sola, anche se i tag la mettono in più sottogruppi.
  - `groupItems(items, by, then, price)` e `groupDeckItems(items, by, then, price)` con
    `then: GroupBy | 'none'`.
  - `byTypeThenMv` sparisce: l'ordine interno diventa MV → nome, e il tipo arriva dai sottogruppi.
  - Nuove `defaultThenBy(by)`, `thenByOptions(by)` e `thenByAfter(from, then, to)`.
- `components/list/ListDetailView.tsx`: stato dei due livelli, secondo select, reset quando collide con
  `groupBy`. La persistenza sta in `store/ui.ts` (`getGrouping` / `setGrouping`, chiave
  `mbv:grouping:<kind>`).
- `components/list/ItemViews.tsx`: rendering dei separatori in entrambe le viste.
- `lib/listGroups.test.ts`: il test dell'ordine per tipo resta valido con Then by = Type; nuovi casi
  per Rarity, None, tag multipli, deck e reset; `store/ui.test.ts` per la persistenza.
- `README.md`: una riga nella sezione Cubes and decks.

## Fuori scope

- Criteri di livello 3 configurabili (l'ordine interno resta MV → nome).
- Salvare la configurazione sul server o per singola lista.
- Export (CubeCobra CSV, Moxfield) e Stats: non cambiano.

## Decisioni

1. **Persistenza:** `localStorage` per browser, separato per cubi e deck.
2. **Separatore:** solo una linea, senza intestazione del sottogruppo (né titolo né contatore).
