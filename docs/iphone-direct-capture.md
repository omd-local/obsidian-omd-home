# Send an iPhone link straight to Current task

> [!IMPORTANT]
> **Development preview — not included in public OMD Home 0.2.1.**
> The previously shared development ZIP is local, not a public GitHub download.
> For an installation available now, use the [Mac beginner guide](getting-started-mac.md).

Tap **Send to OMD / 发送到 OMD** on iPhone to start a URL capture on Mac,
without opening **Capture URL or file** or pasting on the computer. A share-sheet
shortcut sends the link over SSH to the paired Mac, where the existing capture
task runs in the background.

Direct captures use the vault's saved recognition, Polish Markdown, link/tag review and
site-access choices. A direct request never edits those defaults. Social
captures use the matching previously configured cookie path and normal source
readiness checks. Missing dependencies or source access appear in **Needs
attention**, with the existing retry and cancellation behavior.

The pairing commands and direct-capture URI are development additions; they are
not included in the previously published 0.2.1 release assets.

## Mac preparation for the iPhone action

1. Use this plugin build and a compatible OMD backend in the intended vault.
   Verify an ordinary capture before setting up phone delivery.
2. Run **OMD Home: Copy iPhone capture address** on that Mac. This explicitly
   enables URL capture for the address on this device and vault. Keep the
   copied address private. It ends with `&source=` so the shortcut can append
   the encoded link or share text.
3. To allow the iPhone's SSH action, configure macOS **System Settings > General
   > Sharing > Remote Login**, allowing only the intended Mac user. Use the
   username and host address shown there. This plugin does not enable Remote
   Login or configure SSH credentials.
4. Keep the Mac awake, logged in, and reachable from the phone, with the vault
   open and OMD Home enabled. The same Wi-Fi is convenient for a first trial;
   it is not a plugin requirement. Closing the Home tab is fine.

## Across different networks

For iPhone cellular data and a Mac on Wi-Fi, an optional private network such
as Tailscale can provide a reachable device address. Install its official
clients on both devices, join your personal tailnet, and use the Mac's
Tailscale address as the Shortcut's SSH host. This is ordinary macOS SSH over
the private network; it does not require the separate Tailscale SSH server
feature. Tailscale is not bundled or configured by OMD Home.

The network encrypts device traffic but uses a third-party control service
with device and connection metadata. Use account MFA, approve only intended
devices, and narrow tailnet access to the intended iPhone and Mac SSH port.
Tailnet rules govern Tailscale traffic; they do not restrict ordinary LAN SSH.

**SSH credentials are broader than an OMD submission permission.** Ordinary
Remote Login allows commands and files accessible to that macOS user. Writing
one command in a shortcut does not restrict what its credentials can do.
A dedicated key with a server-enforced command or a limited-purpose receiver
is needed to make credentials submission-only. This setup does not yet
provide that restriction. Disconnecting OMD pairing revokes the capture
address, not the SSH key or Tailscale device.

The Mac still needs to be awake and online. There is no offline delivery queue.

Pairing stays in Obsidian's device-local storage, outside synced plugin
settings. **OMD Home: Disconnect iPhone capture** immediately invalidates the
copied address for future requests. Copy a new address to reconnect. Changing
the vault's name requires copying its new address.

## Create the iPhone shortcut once

Name it **Send to OMD / 发送到 OMD**.

1. Enable **Show in Share Sheet** and accept URLs and text. Use the share
   input, or **Get Clipboard** when there is no input. Send one source at a
   time; plain webpage URLs should be shared alone. A complete Douyin or
   Xiaohongshu share message containing one URL is also supported.
2. **URL Encode** that input.
3. Add a **Text** action: paste the Mac's capture address, then append the
   URL-encoded input immediately after `&source=`. Do not encode the entire
   address again.
4. **Base64 Encode** the complete Text output, with line breaks disabled.
5. Add **Run Script over SSH**, using the Mac host, user and SSH authentication
   configured above. Put the **Base64 Encoded** variable inside the single
   quotes below:

   ```sh
   /usr/bin/open -g -u "$(/usr/bin/printf '%s' 'BASE64_VARIABLE' | /usr/bin/base64 -D)"
   ```

   Replace `BASE64_VARIABLE` with the shortcut variable, not the original
   input. Base64 prevents source text from becoming shell syntax. Never put
   the raw URL/share text directly into the shell command.

Now use **Share > Send to OMD**, or copy a link and run the shortcut. Mac
capture starts without displaying the Capture dialog. Progress appears in
**Current task** when Home is visible; results go to the normal Inbox.

The SSH action's exact editor fields vary by iOS version. The plugin route
and task dispatch are covered by automated tests; this guide still requires
an actual iPhone-to-Mac trial with your SSH setup. A successful `open` command
means only that macOS received the URI; it is not a capture receipt or a
completion confirmation.

## Expected limits

- A busy capture or link/tag review rejects a second request. There is no
  offline or automatic waiting queue in this version. Resend after it finishes.
- The Mac must be awake and reachable. Universal Clipboard does not deliver
  the iPhone SSH action.
- Direct capture accepts HTTP(S) sources only. Local paths, file URLs,
  credentials embedded in URLs, multiple sources and extra URI options are
  rejected. Use the ordinary Capture dialog for local files.
- `obsidian://` opened directly on iPhone opens the phone's Obsidian. The SSH
  step is what delivers this address to the Mac.
- Quitting Obsidian, unloading OMD Home or using Cancel stops owned work in
  the same way as an ordinary capture.

## References

- [Apple: run a shortcut from another app](https://support.apple.com/en-gb/guide/shortcuts/apd163eb9f95/ios)
- [Apple: choose input behavior when no input is provided](https://support.apple.com/en-az/guide/shortcuts/apd8195f96d6/ios)
- [Apple: allow SSH access to your Mac](https://support.apple.com/guide/mac-help/allow-a-remote-computer-to-access-your-mac-mchlp1066/mac)
- [Tailscale: connect to devices](https://tailscale.com/docs/how-to/connect-to-devices)
- [Tailscale: encryption](https://tailscale.com/security-policies/encryption-cryptography)
- [Tailscale: privacy policy](https://tailscale.com/legal/privacy-policy)
- [Tailscale: access-control rules and scope](https://tailscale.com/docs/features/access-control/acls)
- [Tailscale: ordinary SSH over Tailscale](https://tailscale.com/docs/reference/ssh-over-tailscale)
