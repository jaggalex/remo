## Result

A room has one public link, and it is the same URL that was copied earlier. For a room with an owner, while the link is on, anyone with the link can read it without an account; for a room without an owner the link leads to the claim screen first. After it is turned off, the link no longer opens the room for anyone.

## Steps

1. Open Share in the room.
2. In the Public link block, click Turn on.
3. Copy the link and send it to people who need read access.
4. To close access, click Turn off. The link stops working for everyone immediately.
5. Set a password or an expiry date if needed.

## Password and expiry

- The password is requested when the link opens. A wrong-password message never claims the password "was recently changed".
- Changing the password closes browsers that were already unlocked: they must enter the new password.
- Expiry is checked on the server. A date in the past is rejected with an explicit error.
- An expired link does not open the room; the owner can set a new expiry or remove it.

## Check the result

- An enabled link opens the room in read mode.
- A disabled link shows neither the title nor the owner — only a message that access is unavailable.
- Turning it on again activates **the same URL**. The interface warns before it is turned on: everyone who saved the link earlier regains read access.

## Limits

- The link never grants editing.
- A room without an owner is not opened by the link: the claim screen appears instead of the content.
- A link cannot be revoked for one person: to close it, turn it off for everyone.
- Only an owner or co-owner can manage the link.
