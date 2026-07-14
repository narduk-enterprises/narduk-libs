import { analyzeUiQualityRoot } from '../playwright/ui-quality-analyzer'

const rootDir = process.argv[2] || 'output/playwright/visual-audit'

try {
  const summary = await analyzeUiQualityRoot(rootDir)
  console.log(JSON.stringify(summary, null, 2))

  if (summary.failures.length > 0) {
    process.exit(1)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
