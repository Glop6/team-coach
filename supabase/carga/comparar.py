"""Compara los CSV de referencia de MS Dash con los mismos números calculados sobre perf.

Uso: python3 -I comparar.py <carpeta_referencia> <carpeta_perf> <nombres_ex_miembros separados por ;>
"""
import csv
import sys
from collections import defaultdict
from decimal import Decimal

ref_dir, perf_dir, ex_arg = sys.argv[1], sys.argv[2], sys.argv[3]
EX = set(n for n in ex_arg.split(";") if n)


def leer(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def num(v):
    return Decimal(v) if v not in ("", None) else Decimal(0)


fallas = []

# 1) Totales por mes: idénticos
ref = {r["mes"]: r for r in leer(f"{ref_dir}/ref_totales_mes.csv")}
per = {r["mes"]: r for r in leer(f"{perf_dir}/perf_totales_mes.csv")}
if ref.keys() != per.keys():
    fallas.append(f"totales_mes: meses distintos {sorted(ref.keys() ^ per.keys())}")
for mes in sorted(ref.keys() & per.keys()):
    for col in ("casos", "registros", "loe", "qa_registros"):
        if num(ref[mes][col]) != num(per[mes][col]):
            fallas.append(f"totales_mes {mes} {col}: ref={ref[mes][col]} perf={per[mes][col]}")
print(f"Totales por mes: {len(ref)} meses comparados")

# 2) Conteos por tabla: idénticos
ref = {r["tabla"]: r["filas"] for r in leer(f"{ref_dir}/ref_conteos_tablas.csv")}
per = {r["tabla"]: r["filas"] for r in leer(f"{perf_dir}/perf_conteos_tablas.csv")}
for t in ref:
    if ref[t] != per.get(t):
        fallas.append(f"conteos {t}: ref={ref[t]} perf={per.get(t)}")
print(f"Conteos por tabla: {len(ref)} comparados")


def por_persona(archivo_ref, archivo_perf, cols):
    """Personas actuales: fila por fila igual. Sin persona: su suma por mes = ex-miembros + lo que siga sin vincular."""
    ref = leer(f"{ref_dir}/{archivo_ref}")
    per = leer(f"{perf_dir}/{archivo_perf}")
    ref_act = {(r["mes"], r["persona"]): r for r in ref if not r["persona"].startswith("(sin persona)")}
    per_act = {(r["mes"], r["persona"]): r for r in per
               if not r["persona"].startswith("(sin persona)") and r["persona"] not in EX}
    if ref_act.keys() != per_act.keys():
        fallas.append(f"{archivo_ref}: filas de personas actuales distintas {sorted(ref_act.keys() ^ per_act.keys())[:5]}")
    for k in ref_act.keys() & per_act.keys():
        for c in cols:
            if c == "casos" or c == "qa_casos":
                continue  # casos distintos no se suman entre filas; se compara abajo solo para personas actuales
            if num(ref_act[k][c]) != num(per_act[k][c]):
                fallas.append(f"{archivo_ref} {k} {c}: ref={ref_act[k][c]} perf={per_act[k][c]}")
        for c in cols:
            if c in ("casos", "qa_casos") and num(ref_act[k][c]) != num(per_act[k][c]):
                fallas.append(f"{archivo_ref} {k} {c}: ref={ref_act[k][c]} perf={per_act[k][c]}")
    suma_ref, suma_per = defaultdict(Decimal), defaultdict(Decimal)
    col_suma = cols[1]  # registros / qa_registros
    for r in ref:
        if r["persona"].startswith("(sin persona)"):
            suma_ref[r["mes"]] += num(r[col_suma])
    for r in per:
        if r["persona"].startswith("(sin persona)") or r["persona"] in EX:
            suma_per[r["mes"]] += num(r[col_suma])
    if dict(suma_ref) != dict(suma_per):
        fallas.append(f"{archivo_ref}: suma de sin persona por mes distinta")
    print(f"{archivo_ref}: {len(ref_act)} filas de personas actuales; sin persona → ex-miembros: "
          f"{sum(suma_ref.values())} = {sum(suma_per.values())}")


por_persona("ref_casos_horas_persona_mes.csv", "perf_casos_horas_persona_mes.csv", ["casos", "registros", "loe"])
por_persona("ref_qa_persona_mes.csv", "perf_qa_persona_mes.csv", ["qa_casos", "qa_registros", "qa_na"])

print()
if fallas:
    print(f"DIFERENCIAS: {len(fallas)}")
    for x in fallas[:30]:
        print(" -", x)
    sys.exit(1)
print("TODO COINCIDE")
