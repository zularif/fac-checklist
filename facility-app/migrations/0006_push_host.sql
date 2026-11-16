-- Each phone is tied to the host email its owner entered, so a permit notification
-- reaches only the host the vendor named on the form.
ALTER TABLE push_subscriptions ADD COLUMN host_email TEXT;
