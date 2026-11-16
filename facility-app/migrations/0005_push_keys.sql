-- Lets the phone notification carry the message text (the text is encrypted for each phone with these keys).
ALTER TABLE push_subscriptions ADD COLUMN p256dh TEXT;
ALTER TABLE push_subscriptions ADD COLUMN auth TEXT;
