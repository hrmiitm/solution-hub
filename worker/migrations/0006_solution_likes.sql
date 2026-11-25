CREATE TABLE solution_likes (
  solution_id TEXT NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (solution_id, user_id)
) WITHOUT ROWID;

CREATE INDEX idx_solution_likes_user ON solution_likes (user_id, solution_id);
