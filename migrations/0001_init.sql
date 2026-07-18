-- Core account and domain schema. The migration runner wraps each file in a
-- transaction, so no BEGIN/COMMIT here. Requires PostgreSQL >= 14.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  name          text,
  image         text,
  password_hash text,                                        -- NULL for Google-only users
  role          text CHECK (role IN ('patient', 'doctor')),  -- NULL until onboarding is complete
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

CREATE TABLE accounts (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            text NOT NULL,
  provider_account_id text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_account_id)
);
CREATE INDEX accounts_user_id_idx ON accounts (user_id);

CREATE TABLE fields (
  id   smallint PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE user_fields (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field_id   smallint NOT NULL REFERENCES fields(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, field_id)
);

CREATE FUNCTION enforce_max_two_user_fields() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM user_fields WHERE user_id = NEW.user_id) >= 2 THEN
    RAISE EXCEPTION 'user % already has the maximum of 2 fields', NEW.user_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_fields_max_two
  BEFORE INSERT ON user_fields
  FOR EACH ROW EXECUTE FUNCTION enforce_max_two_user_fields();

CREATE TABLE literature (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field_id   smallint NOT NULL REFERENCES fields(id),
  title      text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  authors    text NOT NULL CHECK (char_length(authors) BETWEEN 1 AND 1000),
  journal    text NOT NULL CHECK (char_length(journal) BETWEEN 1 AND 300),
  year       integer NOT NULL CHECK (year BETWEEN 1800 AND 2100),
  doi        text CHECK (doi ~ '^10\.\d{4,9}/\S+$'),
  pubmed_url text CHECK (pubmed_url ~ '^https://(pubmed\.ncbi\.nlm\.nih\.gov|www\.ncbi\.nlm\.nih\.gov)/'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (doi IS NOT NULL OR pubmed_url IS NOT NULL)
);
CREATE INDEX literature_field_created_idx ON literature (field_id, created_at DESC);
CREATE INDEX literature_doctor_idx ON literature (doctor_id);
