/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ═══ LAYER RULES (within each bounded context) ═══

    {
      name: "no-domain-depends-on-infrastructure",
      comment: "Domain layer must not import from infrastructure",
      severity: "error",
      from: { path: "^src/[^/]+/domain/" },
      to: { path: "^src/[^/]+/infrastructure/" },
    },
    {
      name: "no-domain-depends-on-application",
      comment: "Domain layer must not import from application",
      severity: "error",
      from: { path: "^src/[^/]+/domain/" },
      to: { path: "^src/[^/]+/application/" },
    },
    // NOTE: Application → Infrastructure within the SAME bounded context is allowed.
    // Cross-context isolation rules below prevent the problematic case
    // (application in context A importing infrastructure from context B).

    // ═══ BOUNDED CONTEXT ISOLATION ═══

    {
      name: "no-terminal-depends-on-session",
      severity: "error",
      from: { path: "^src/terminal/" },
      to: { path: "^src/session/" },
    },
    {
      name: "no-terminal-depends-on-intelligence",
      severity: "error",
      from: { path: "^src/terminal/" },
      to: { path: "^src/intelligence/" },
    },
    {
      name: "no-intelligence-depends-on-session",
      severity: "error",
      from: { path: "^src/intelligence/" },
      to: { path: "^src/session/" },
    },
    {
      name: "no-intelligence-depends-on-terminal",
      severity: "error",
      from: { path: "^src/intelligence/" },
      to: { path: "^src/terminal/" },
    },
    {
      name: "no-session-depends-on-intelligence",
      severity: "error",
      from: { path: "^src/session/" },
      to: { path: "^src/intelligence/" },
    },
    {
      name: "no-session-depends-on-terminal-infrastructure",
      comment: "Session may use Terminal domain types but not infrastructure",
      severity: "error",
      from: { path: "^src/session/" },
      to: { path: "^src/terminal/infrastructure/" },
    },
    {
      name: "no-plan-depends-on-session",
      severity: "error",
      from: { path: "^src/plan/" },
      to: { path: "^src/session/" },
    },
    {
      name: "no-plan-depends-on-terminal",
      severity: "error",
      from: { path: "^src/plan/" },
      to: { path: "^src/terminal/" },
    },
    {
      name: "no-plan-depends-on-intelligence",
      severity: "error",
      from: { path: "^src/plan/" },
      to: { path: "^src/intelligence/" },
    },
    {
      name: "no-session-depends-on-plan",
      severity: "error",
      from: { path: "^src/session/" },
      to: { path: "^src/plan/" },
    },
    {
      name: "no-terminal-depends-on-plan",
      severity: "error",
      from: { path: "^src/terminal/" },
      to: { path: "^src/plan/" },
    },
    {
      name: "no-intelligence-depends-on-plan",
      severity: "error",
      from: { path: "^src/intelligence/" },
      to: { path: "^src/plan/" },
    },

    // ═══ SHARED KERNEL PROTECTION ═══

    {
      name: "no-shared-depends-on-contexts",
      comment: "Shared kernel must not depend on any bounded context",
      severity: "error",
      from: { path: "^src/shared/" },
      to: { path: "^src/(terminal|session|intelligence|plan)/" },
    },

    // ═══ CLIENT ISOLATION ═══

    {
      name: "no-client-depends-on-server",
      comment: "React client must not import server-side code",
      severity: "error",
      from: { path: "^web/src/client/" },
      to: { path: "^src/(terminal|session|intelligence|plan)/" },
    },
  ],

  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
  },
};
