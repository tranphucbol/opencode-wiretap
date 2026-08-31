// Single-command dev orchestrator: runs the @wiretap/server Express API
// (Bun, watched) and the @wiretap/web Vite dev server together, each in
// its own workspace directory, forwarding output and Ctrl-C to both.

const procs = [
  {
    name: "api",
    cmd: ["bun", "--watch", "src/index.ts"],
    cwd: "packages/server",
    color: "\x1b[36m", // cyan
  },
  {
    name: "web",
    cmd: ["bunx", "vite"],
    cwd: "packages/web",
    color: "\x1b[35m", // magenta
  },
];

const reset = "\x1b[0m";

const children = procs.map((p) => {
  const child = Bun.spawn(p.cmd, {
    cwd: new URL(`../${p.cwd}/`, import.meta.url).pathname,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, FORCE_COLOR: "1" },
  });

  const prefix = `${p.color}[${p.name}]${reset} `;
  for (const stream of [child.stdout, child.stderr]) {
    (async () => {
      const decoder = new TextDecoder();
      let buf = "";
      for await (const chunk of stream) {
        buf += decoder.decode(chunk, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) process.stdout.write(prefix + line + "\n");
      }
    })();
  }
  return child;
});

function shutdown() {
  for (const c of children) c.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await Promise.all(children.map((c) => c.exited));
