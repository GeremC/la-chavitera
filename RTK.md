# Command output

Command output here is condensed to save tokens, keeping every signal and
dropping costly noise. Treat it as the complete result: run commands
normally, and batch related commands into one call to avoid extra turns.
Truncated results state their recovery path in their own output. Re-run a
command as `rtk bypass <cmd>` only when its result is unusable: empty when
output was clearly expected, contradicting its exit code, or garbled.

## RTK in this repo

This project uses [RTK (Rust Token Killer)](https://github.com/rtk-ai/rtk).
A `PreToolUse` hook in `.claude/settings.json` runs `rtk hook claude`, which
rewrites Bash commands (for example `git status` becomes `rtk git status`) so
their output is condensed. If `rtk` is not installed, the hook does nothing.

Useful meta commands: `rtk gain` (token savings), `rtk discover` (missed
opportunities), `rtk bypass <cmd>` (run a command without filtering).
