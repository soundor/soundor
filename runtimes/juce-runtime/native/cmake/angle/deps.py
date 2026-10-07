"""Checks out the third-party code an ANGLE build needs, each at the commit
ANGLE's own DEPS file pins, and writes the gn arguments gclient would have.

  deps.py <angle checkout> <path>[=<sparse dir>,...] ...

A path given as `path=dir1,dir2` is a sparse checkout of just those
directories (for repositories ANGLE's build only reads a file or two of).

DEPS is Python syntax; it is read with `ast`, never executed: only the
literals, Var(), Str() and `+` that DEPS files use are understood.
"""

import ast
import os
import re
import subprocess
import sys


def evaluate(node, variables):
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        return evaluate(node.left, variables) + evaluate(node.right, variables)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        argument = evaluate(node.args[0], variables)
        if node.func.id == 'Var':
            return variables[argument]
        if node.func.id == 'Str':
            return argument
    if isinstance(node, ast.Dict):
        return {evaluate(k, variables): evaluate(v, variables) for k, v in zip(node.keys, node.values)}
    if isinstance(node, ast.List):
        return [evaluate(item, variables) for item in node.elts]
    raise ValueError(f'unsupported DEPS syntax at line {node.lineno}')


def read_deps(path):
    tree = ast.parse(open(path, encoding='utf-8').read(), path)
    assignments = {}
    for statement in tree.body:
        if isinstance(statement, ast.Assign) and isinstance(statement.targets[0], ast.Name):
            assignments[statement.targets[0].id] = statement.value
    variables = {}
    # Variables may refer to earlier ones; DEPS defines them in order.
    for key, value in zip(assignments['vars'].keys, assignments['vars'].values):
        variables[evaluate(key, variables)] = evaluate(value, variables)
    deps = evaluate(assignments['deps'], variables)
    gn_args = evaluate(assignments['gclient_gn_args'], variables)
    return deps, variables, gn_args


def git(directory, *arguments):
    subprocess.run(['git', *arguments], cwd=directory, check=True)


def checkout(directory, url, revision, sparse):
    if os.path.isdir(os.path.join(directory, '.git')):
        return
    os.makedirs(directory, exist_ok=True)
    git(directory, 'init', '--quiet')
    fetch = ['fetch', '--quiet', '--depth', '1']
    if sparse:
        git(directory, 'sparse-checkout', 'set', '--no-cone', *[f'/{d}/' for d in sparse])
        fetch.append('--filter=blob:none')
    git(directory, *fetch, url, revision)
    git(directory, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', 'FETCH_HEAD')


def gn_value(value):
    if isinstance(value, bool):
        return 'true' if value else 'false'
    return '"' + str(value) + '"'


def main():
    root, wanted = sys.argv[1], sys.argv[2:]
    deps, variables, gn_args = read_deps(os.path.join(root, 'DEPS'))
    for entry in wanted:
        path, _, sparse = entry.partition('=')
        spec = deps[path]
        url = spec if isinstance(spec, str) else spec['url']
        # gclient also expands {name} in strings.
        url = re.sub(r'\{(\w+)\}', lambda match: str(variables[match.group(1)]), url)
        repository, _, revision = url.partition('@')
        if len(revision) != 40:
            sys.exit(f'{path} is not pinned to a commit in DEPS: {url}')
        print(f'ANGLE: fetching {path} {revision[:10]}', flush=True)
        checkout(os.path.join(root, path), repository, revision, [d for d in sparse.split(',') if d])
    # What `gclient sync` writes from DEPS' gclient_gn_args. The checkout_*
    # flags say which optional repositories were checked out: none of them.
    with open(os.path.join(root, 'build', 'config', 'gclient_args.gni'), 'w', encoding='utf-8') as out:
        for name in gn_args:
            value = False if name.startswith('checkout_') else variables[name]
            out.write(f'{name} = {gn_value(value)}\n')


if __name__ == '__main__':
    main()
