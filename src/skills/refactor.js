export const refactorSkill = {
  name: "refactor-master",
  triggers: ["refactor", "clean", "improve", "optimize", "restructure", "simplify"],
  prompt: `
## CODE REFACTORING EXPERT

Refactor code while preserving exact external behavior.

**GOALS:**
- Reduce complexity (extract functions, early returns)
- Improve readability (clear naming, comments)
- Eliminate duplication (DRY)
- Enhance type safety (TypeScript)
- Add error handling where missing
- Suggest performance improvements (memoization, lazy loading)

**RULES:**
- No logic changes
- Explain before/after diffs
- Explain trade-offs if any
`,
};
