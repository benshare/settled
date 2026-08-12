-- The username rules (3-20 chars, letters/digits/underscore) have only ever
-- been enforced client-side. Account deletion hard-deletes the profiles row and
-- the client synthesizes a placeholder for the dangling id, displayed as
-- '[deleted user]' — a sentinel a real account could adopt is an impersonation
-- vector, and the format rule is what makes it unreachable.
--
-- NOT VALID binds every future insert and update without asserting anything
-- about rows written before the rule existed (dev seed users predate it). Run
-- `alter table public.profiles validate constraint profiles_username_format`
-- separately if the existing rows are ever confirmed clean.
alter table public.profiles
    add constraint profiles_username_format
    check (username ~ '^[A-Za-z0-9_]{3,20}$')
    not valid;
