# Re-record the README demo with: vhs docs/demo.tape

Output docs/assets/demo.gif

Require bun

Set Shell "zsh"
Set FontFamily "FiraCode Nerd Font Mono"
Set FontSize 16
Set Width 1200
Set Height 720
Set Theme "TokyoNight"
Set Padding 12
Set Framerate 12
Set TypingSpeed 30ms

Hide
Type "bun run seed"
Enter
Sleep 1s
Type "env -u ANTHROPIC_API_KEY -u DASHSCOPE_API_KEY -u OPENAI_API_KEY -u DEEPSEEK_API_KEY -u MOONSHOT_API_KEY -u LAZYSQL_LLM_PROVIDER -u LAZYSQL_LLM_MODEL -u LAZYSQL_LLM_BASE_URL -u LAZYSQL_SECRETS LAZYSQL_CONFIG_DIR=$(mktemp -d) bun run src/main.tsx data/sample.db"
Enter
Sleep 3s
Down
Enter
Sleep 2s
Show

Sleep 1500ms
Down@180ms 3
Right@180ms
Sleep 500ms
Type "s"
Sleep 1500ms
Type "/"
Sleep 300ms
Type@100ms "Alice"
Sleep 300ms
Enter
Sleep 1800ms
Right@180ms
Down@180ms
Enter
Sleep 1800ms
Escape
Sleep 500ms
Type ":"
Sleep 500ms
Type@25ms "select name, email from users where active = 1 order by created_at desc limit 12;"
Sleep 700ms
Enter
Sleep 2s
Ctrl+O
Sleep 1500ms
Hide
Ctrl+C
