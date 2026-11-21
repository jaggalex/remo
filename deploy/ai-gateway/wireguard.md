# WireGuard between remo and the AI gateway

The sync service reaches the gateway only through a two-host tunnel (ADR-251 §6.1).
VPS 1 runs remo; VPS 2 runs `remo-ai-gateway` and is the only host that talks to model
providers. The tunnel is a /30: two addresses, one peer each.

| Host | Tunnel address | Public address |
|---|---|---|
| VPS 1, remo | `10.77.0.1` | its own public address; `VPS1_PUBLIC` in `nftables.conf` |
| VPS 2, gateway | `10.77.0.2` | `<VPS2_PUBLIC>` in the peer below |

`AllowedIPs` on each side names **only the other tunnel address**. Never `0.0.0.0/0`:
routing all traffic through VPS 2 would move provider calls back onto the remo host's
exit and undo the isolation.

Keys are generated on each host and never leave it. Nothing in this directory is a key.

## 1. Generate the keys in place

On both hosts:

```sh
apt install -y wireguard-tools
umask 077
install -d -m 700 /etc/wireguard
wg genkey > /etc/wireguard/wg0.key
wg pubkey < /etc/wireguard/wg0.key > /etc/wireguard/wg0.pub
chmod 600 /etc/wireguard/wg0.key
```

Read each `wg0.pub` and exchange the two public keys out of band (not in the repository,
not in a chat room). A public key is safe to copy; the private key never is.

## 2. VPS 2 (gateway) — listen and accept one peer

`/etc/wireguard/wg0.conf`, mode `600`:

```ini
[Interface]
# .2 is the gateway; /30 leaves .0 as the network and .3 as broadcast.
Address = 10.77.0.2/30
ListenPort = 51820
PrivateKey = <contents of /etc/wireguard/wg0.key on VPS 2>

[Peer]
# VPS 1, remo.
PublicKey = <contents of /etc/wireguard/wg0.pub on VPS 1>
AllowedIPs = 10.77.0.1/32
```

No `Endpoint` here: VPS 1 starts the tunnel, VPS 2 answers. No `PersistentKeepalive`
either; the side that owns the endpoint keeps it alive.

The public interface must not be trusted: the nftables example in `nftables.conf` opens
UDP 51820 only to the public address of VPS 1.

## 3. VPS 1 (remo) — dial the gateway

`/etc/wireguard/wg0.conf`, mode `600`:

```ini
[Interface]
Address = 10.77.0.1/30
# A fixed source port keeps the VPS 2 firewall rule symmetrical.
ListenPort = 51820
PrivateKey = <contents of /etc/wireguard/wg0.key on VPS 1>

[Peer]
# VPS 2, ai-gateway.
PublicKey = <contents of /etc/wireguard/wg0.pub on VPS 2>
Endpoint = <VPS2_PUBLIC>:51820
AllowedIPs = 10.77.0.2/32
PersistentKeepalive = 25
```

If VPS 1 runs `ufw`, allow the one outbound flow:

```sh
ufw allow out to <VPS2_PUBLIC> port 51820 proto udp
```

## 4. Bring the tunnel up

On both hosts:

```sh
systemctl enable --now wg-quick@wg0
```

Then check from VPS 1:

```sh
wg show wg0                       # a recent "latest handshake" and non-zero transfer
ping -c 3 10.77.0.2
```

`ping` is the check, not a service: the gateway listens on TCP 8080 and answers only
after the tunnel works. A missing handshake means the port is closed, the public key is
wrong, or the endpoint address is stale.

## 5. What not to do

- Do not put a private key, a `wg0.conf` or a QR code into the repository, a ticket or a
  backup that leaves the host. To rotate, repeat step 1 on one host, replace the public
  key in the peer file on the other, and restart `wg-quick@wg0` on both.
- Do not add a route for `10.77.0.0/30` to a router or a second interface. The two hosts
  own the subnet; a third route makes the firewall rules meaningless.
- Do not expose the admin API through the tunnel. It binds `127.0.0.1:8081`; the
  firewall example has no rule for it, on `wg0` or anywhere else.
- The default WireGuard MTU is 1420. Lower it on both interfaces (for example `MTU =
  1380`) if the provider itself tunnels traffic and large provider responses stall.

Next: the firewall in `nftables.conf`, then `compose.yml` or
`remo-ai-gateway.service`.
