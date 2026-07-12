import mysql from 'mysql2/promise'
import {
  FindLastGamesQueryModel,
  FindLastGamesQueryService
} from '../../application/query/findLastGamesQueryService'

export class FindLastGameMySQLQueryService
  implements FindLastGamesQueryService
{
  async query(
    conn: mysql.Connection,
    limit: number
  ): Promise<FindLastGamesQueryModel[]> {
    const selectResult = await conn.execute<mysql.RowDataPacket[]>(
      `
select
  max(g.id) as game_id,
  sum(case when m.disc = 1 then 1 else 0 end) as dark_move_count,
  sum(case when m.disc = 2 then 1 else 0 end) as light_move_count,
  max(gr.winner_disc) as winner_disc,
  max(g.started_at) as started_at,
  max(gr.end_at) as end_at
from games g
left join game_results gr on gr.game_id = g.id
left join turns t on t.game_id = g.id
left join moves m on m.turn_id = t.id
group by g.id
order by g.id desc
limit ?
`,
      [limit.toString()]
    )
    const records = selectResult[0]

    return records.map((r) => {
      return new FindLastGamesQueryModel(
        r['game_id'],
        r['dark_move_count'],
        r['light_move_count'],
        r['winner_disc'],
        r['started_at'],
        r['end_at']
      )
    })
  }
}
