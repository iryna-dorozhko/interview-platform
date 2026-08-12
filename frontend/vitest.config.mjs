/** Канонічний vitest-конфіг пакета: node-environment, pool forks, v8 coverage. */
import { defineConfig } from 'vitest/config'

/** Vitest-конфіг: include обох розкладок тестів, ізоляція forks, lcov-coverage. */
export default defineConfig({
  test: {
    // Підхоплюються обидві основні розкладки: тести поряд із кодом (rule `test`-конвенція —
    // у піддиректоріях `tests/`) і top-level integration suites у `<root>/tests/`.
    include: ['**/*.test.{js,mjs,ts}', 'tests/**/*.test.{js,mjs,ts}'],
    // reports/stryker/.tmp/ містить sandbox-копії тестів від Stryker (incremental
    // або aborted-runs); без exclude vitest run --coverage їх підхоплює і вони
    // фейляться, бо запускаються поза реальним repo root.
    exclude: ['**/node_modules/**', '**/dist/**', '**/reports/stryker/**'],
    environment: 'node',
    // `pool: 'forks'` — defense-in-depth ізоляція процесів між test-файлами.
    // У default `pool: 'threads'` усі workers ділять один процес → паралельний
    // `process.chdir(dir)` у тестовій фікстурі перехоплює cwd сусіда посеред
    // FS- або `git`-операції. Реальний інцидент: `git init`+`git commit` із
    // tmp-фікстури потрапив у реальний робочий репозиторій. Forks гарантують
    // ізоляцію. Канон тестів — `withTmpDir(async dir => ...)` (test.mdc).
    pool: 'forks',
    // Ті самі Vue/Pinia/Router globals, що й `bun test --preload ./bun.test.preload.ts`.
    setupFiles: ['./bun.test.preload.ts'],
    coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] }
  }
})
