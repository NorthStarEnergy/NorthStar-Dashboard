"""Compile bounded numeric data expressions to parameterized SQL. Never eval/exec."""
import ast
import math
import re

class Expression:
    def __init__(self, columns, formulas=None):
        self.columns = columns
        self.formulas = formulas or {}
        self.parameters = []
        self.visiting = set()
        self.nodes = 0

    def compile(self, source):
        if not isinstance(source,str) or not source.strip() or len(source)>800:
            raise ValueError('Use an expression of 1–800 characters')
        try:
            tree = ast.parse(source.strip().removeprefix('='),mode='eval')
        except (SyntaxError,RecursionError) as exc:
            raise ValueError('Invalid expression. Use field names, arithmetic and documented functions.') from exc
        return self.visit(tree.body,0)

    def visit(self,node,depth):
        self.nodes+=1
        if depth>16 or self.nodes>150:
            raise ValueError('Expression is too complex')
        v=lambda child:self.visit(child,depth+1)
        if isinstance(node,ast.Constant):
            if node.value is None:return 'NULL'
            if isinstance(node.value,bool):return 'TRUE' if node.value else 'FALSE'
            if not isinstance(node.value,(int,float)) or not math.isfinite(node.value) or abs(node.value)>1e15:
                raise ValueError('Only finite numeric constants up to 10^15 are supported')
            self.parameters.append(float(node.value));return '(%s::double precision)'
        if isinstance(node,ast.Name):
            if node.id in self.formulas:
                if node.id in self.visiting:raise ValueError('Circular formula dependency')
                self.visiting.add(node.id)
                value=self.compile(self.formulas[node.id])
                self.visiting.remove(node.id)
                return '('+value+')'
            if node.id not in self.columns or self.columns[node.id]['type'] not in ('number','integer'):
                raise ValueError('Unknown numeric field: '+node.id)
            return '"'+node.id+'"'
        if isinstance(node,ast.BinOp):
            a,b=v(node.left),v(node.right)
            op={ast.Add:'+',ast.Sub:'-',ast.Mult:'*'}.get(type(node.op))
            if op:return f'({a} {op} {b})'
            if isinstance(node.op,ast.Div):return f'({a} / NULLIF({b},0))'
        if isinstance(node,ast.UnaryOp) and isinstance(node.op,(ast.USub,ast.UAdd)):
            return ('(-' if isinstance(node.op,ast.USub) else '(+')+v(node.operand)+')'
        if isinstance(node,ast.Compare) and len(node.ops)==1:
            op={ast.Eq:'=',ast.NotEq:'<>',ast.Lt:'<',ast.LtE:'<=',ast.Gt:'>',ast.GtE:'>='}.get(type(node.ops[0]))
            if op:return f'({v(node.left)} {op} {v(node.comparators[0])})'
        if isinstance(node,ast.BoolOp) and isinstance(node.op,(ast.And,ast.Or)):
            return '('+(' AND ' if isinstance(node.op,ast.And) else ' OR ').join(v(n) for n in node.values)+')'
        if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and not node.keywords:
            name=node.func.id.lower(); args=node.args
            if name=='ifelse' and len(args)==3:return f'(CASE WHEN {v(args[0])} THEN {v(args[1])} ELSE {v(args[2])} END)'
            if name in ('abs','sqrt','floor','ceil') and len(args)==1:return name.upper()+'('+v(args[0])+')'
            if name in ('coalesce','min','max') and 2<=len(args)<=8:
                return {'coalesce':'COALESCE','min':'LEAST','max':'GREATEST'}[name]+'('+','.join(v(a) for a in args)+')'
            if name=='round' and len(args) in (1,2):
                digits=0 if len(args)==1 else args[1].value if isinstance(args[1],ast.Constant) else None
                if type(digits) is not int or not 0<=digits<=8:raise ValueError('ROUND precision must be an integer from 0 to 8')
                return f'ROUND(({v(args[0])})::numeric,{digits})::double precision'
        raise ValueError('Unsupported expression. No SQL, Python, file or network commands are allowed.')

def script_lines(source,columns,formulas):
    if not isinstance(source,str) or len(source)>8000:raise ValueError('Script must be at most 8,000 characters')
    result=[]
    for line in source.splitlines():
        line=line.strip()
        if not line or line.startswith('#'):continue
        match=re.fullmatch(r'SET\s+([a-z][a-z0-9_]*)\s*=\s*(.+)',line,re.I)
        if not match:raise ValueError('Use one SET field = expression statement per line')
        key,expr=match.groups()
        if key not in columns or columns[key]['type']!='number' or key.startswith('_'):
            raise ValueError('Scripts can update editable decimal-number fields only')
        compiler=Expression(columns,formulas);compiler.compile(expr)
        if key in [r[0] for r in result]:raise ValueError('Assign each field once per script')
        result.append((key,expr))
    if not 1<=len(result)<=8:raise ValueError('Use 1–8 SET statements; all expressions use original row values')
    return result
