import { searchTokens } from '../shared/search-text'

import folds from './unicode-search-folds.json'

const foldBinding = JSON.stringify(folds)

/**
 * The SQL equivalent of matchesSearchText, before COUNT/LIMIT. `expression`
 * must be application-owned SQL, never request input; the needle is bound.
 * No stored index, extension or full-row transfer to JavaScript is needed.
 *
 * ASCII (and the common middle-dot separator) uses SQLite's cheap lower().
 * Other text folds inside the query using a materialized Unicode lookup and
 * algorithmic Hangul decomposition. Punctuation need not be rewritten: query
 * tokens contain letters/numbers only, so every separator breaks a substring.
 */
export function sqliteSearchPredicate(
  expression: string,
  needle: string,
): { bindings: string[]; sql: string } {
  const words = [...new Set(searchTokens(needle))]
  if (!words.length) return { sql: '1', bindings: [] }
  return {
    sql: `(WITH RECURSIVE
      search_input(value) AS (SELECT COALESCE(${expression},'')),
      search_folds AS MATERIALIZED (
        SELECT CAST(key AS INTEGER) AS point,value FROM json_each(?)
      ),
      search_chars(pos,folded) AS (
        SELECT 1,''
        UNION ALL
        SELECT pos+1,folded||CASE
          WHEN unicode(substr(search_input.value,pos,1)) BETWEEN 44032 AND 55203 THEN
            char(4352+(unicode(substr(search_input.value,pos,1))-44032)/588)||
            char(4449+((unicode(substr(search_input.value,pos,1))-44032)%588)/28)||
            CASE WHEN (unicode(substr(search_input.value,pos,1))-44032)%28=0 THEN ''
              ELSE char(4519+(unicode(substr(search_input.value,pos,1))-44032)%28) END
          ELSE COALESCE(f.value,lower(substr(search_input.value,pos,1))) END
        FROM search_chars CROSS JOIN search_input
        LEFT JOIN search_folds f ON f.point=unicode(substr(search_input.value,pos,1))
        WHERE pos<=length(search_input.value)
      )
      SELECT NOT EXISTS (
        SELECT 1 FROM json_each(?) word
        WHERE instr(CASE WHEN search_input.value NOT GLOB '*[^ -~·]*' THEN lower(search_input.value)
          ELSE (SELECT folded FROM search_chars WHERE pos>length(search_input.value)) END,word.value)=0
      ) FROM search_input)`,
    bindings: [foldBinding, JSON.stringify(words)],
  }
}
