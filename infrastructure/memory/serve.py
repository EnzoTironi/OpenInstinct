"""One writer, reachable on both Fly's private IPv6 and IPv4 health probes."""

import socket

import uvicorn


if __name__ == "__main__":
    with socket.create_server(
        ("::", 8000), family=socket.AF_INET6, dualstack_ipv6=True
    ) as listener:
        server = uvicorn.Server(
            uvicorn.Config("app:app", workers=1, access_log=False)
        )
        server.run(sockets=[listener])
