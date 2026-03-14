CREATE TABLE IF NOT EXISTS subscriptions (
    channel_id        TEXT NOT NULL,
    project_id        TEXT NOT NULL,
    latest_version_id TEXT,
    PRIMARY KEY (channel_id, project_id)
);
