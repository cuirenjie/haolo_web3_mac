// Load the real imports used by extracted renderer functions. Reading import
// declarations keeps these harnesses valid across optional feature additions;
// missing exports/modules still fail instead of being replaced with test stubs.
export async function rendererImports(ast, names) {
  const result = {};
  for (const statement of ast.statements) {
    const bindings = statement.importClause?.namedBindings?.elements || [];
    const wanted = bindings.filter(binding => names.includes(binding.name.text));
    if (!wanted.length) continue;
    const module = await import(new URL(statement.moduleSpecifier.text,
      new URL('../../src/renderer/main.ts', import.meta.url)));
    for (const binding of wanted) {
      const key = binding.propertyName?.text || binding.name.text;
      if (!(key in module)) throw new Error(`Missing renderer import: ${key}`);
      result[binding.name.text] = module[key];
    }
  }
  return result;
}
