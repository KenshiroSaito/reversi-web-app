export interface Migration {
  version: string;
  statements: string[];
}

// Applied in order by `npm run migrate`. Never edit or reorder a migration
// that has been applied anywhere; add a new one instead. MySQL DDL is not
// transactional, so statements use `if not exists` and a migration that was
// interrupted part-way can simply be run again.
//
// The list lives in TypeScript rather than .sql files so it is always
// bundled into the Vercel Function, where the schema check needs it.
export const MIGRATIONS: Migration[] = [
  {
    version: "001_create_players_and_game_players",
    statements: [
      `create table if not exists players (
        id              int primary key auto_increment,
        token_hash      binary(32) not null,
        display_name    varchar(32) not null,
        created_ip_hash binary(32) null,
        created_at      datetime(3) not null default current_timestamp(3),
        unique key uq_players_token_hash (token_hash),
        key ix_players_ip_created (created_ip_hash, created_at)
      )`,
      `create table if not exists game_players (
        game_id    int not null,
        disc       tinyint not null,
        player_id  int not null,
        created_at datetime(3) not null default current_timestamp(3),
        primary key (game_id, disc),
        key ix_game_players_player_created (player_id, created_at),
        constraint fk_game_players_game foreign key (game_id) references games (id),
        constraint fk_game_players_player foreign key (player_id) references players (id),
        constraint ck_game_players_disc check (disc in (1, 2))
      )`,
    ],
  },
];
