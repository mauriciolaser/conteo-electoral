(function attachProjectionModes(global) {
  const TOP_N = 6;
  const SANCHEZ_PARTY = "JUNTOS POR EL PERU";
  const RLA_PARTY = "RENOVACION POPULAR";

  // Tiers basados en popularidad promedio real en las top 6 regiones pro-Sánchez
  // (medida sobre votos válidos acumulados en esas regiones, corte 54.5% actas):
  //   Tier S: Sánchez          ~27%  → ×1.45 (fijo, es el candidato dominante)
  //   Tier A: ≥10%             Cívico Obras ~15%, Ahora Nación ~12%  → ×1.20
  //   Tier B: 5–10%            Fuerza Popular ~7%, Buen Gobierno ~6.5%  → ×1.00
  //   Tier C: 2–5%             Cooperación Popular, Renovación Popular, Frente Esperanza,
  //                            Sicreo, País para Todos, Venceremos, Primero la Gente  → ×0.80
  //   Tier D: <2%              resto  → ×0.55
  const RURAL_TIERS = {
    S: { multiplier: 1.45, parties: new Set([SANCHEZ_PARTY]) },
    A: { multiplier: 1.20, parties: new Set([
      "PARTIDO CIVICO OBRAS",
      "AHORA NACION - AN",
    ]) },
    B: { multiplier: 1.00, parties: new Set([
      "FUERZA POPULAR",
      "PARTIDO DEL BUEN GOBIERNO",
    ]) },
    C: { multiplier: 0.80, parties: new Set([
      "PARTIDO POLITICO COOPERACION POPULAR",
      "RENOVACION POPULAR",
      "PARTIDO FRENTE DE LA ESPERANZA 2021",
      "PARTIDO SICREO",
      "PARTIDO PAIS PARA TODOS",
      "ALIANZA ELECTORAL VENCEREMOS",
      "PRIMERO LA GENTE - COMUNIDAD, ECOLOGIA, LIBERTAD Y PROGRESO",
    ]) },
    // Tier D (default): ×0.55
  };
  const RURAL_MULTIPLIER_D = 0.55;

  function normalizeName(name) {
    return (name || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .trim();
  }

  function isSpecial(name) {
    const n = normalizeName(name);
    return n.includes("BLANCO") ||
      n.includes("NULO") ||
      n.includes("VICIADO") ||
      n.includes("IMPUGN") ||
      n === "AJUSTE";
  }

  function roundSharesToTotal(valuesByKey, totalTarget) {
    const entries = Object.entries(valuesByKey);
    if (!entries.length) return {};

    const floors = {};
    const remainders = [];
    let assigned = 0;

    for (const [key, value] of entries) {
      const safeValue = Math.max(0, Number(value) || 0);
      const floored = Math.floor(safeValue);
      floors[key] = floored;
      assigned += floored;
      remainders.push({ key, remainder: safeValue - floored });
    }

    let remaining = Math.max(0, totalTarget - assigned);
    remainders.sort((a, b) => b.remainder - a.remainder);

    for (let i = 0; i < remainders.length && remaining > 0; i += 1) {
      floors[remainders[i].key] += 1;
      remaining -= 1;
    }

    return floors;
  }

  function buildRegionProjection(region) {
    const actasPct = Number(region.actas_pct) || 0;
    const emitidos = parseInt(region.emitidos_actual, 10) || 0;
    const projectedTotal = actasPct > 0
      ? Math.round((emitidos * 100) / actasPct)
      : emitidos;
    const remainingVotes = Math.max(0, projectedTotal - emitidos);
    const factor = emitidos > 0 ? projectedTotal / emitidos : 1;

    return {
      projectedTotal,
      remainingVotes,
      factor,
    };
  }

  function buildProjectedByParty(region, factor) {
    const projectedByParty = {};
    for (const party of region.partidos || []) {
      const name = (party.nombre || "").trim();
      if (!name) continue;
      const votes = parseInt(party.votos, 10) || 0;
      projectedByParty[name] = votes * factor;
    }
    return projectedByParty;
  }

  function getLeadingValidParty(region) {
    return (region.partidos || [])
      .filter(party => !isSpecial(party.nombre || ""))
      .reduce((best, party) => {
        const votes = parseInt(party.votos, 10) || 0;
        if (votes > best.votes) {
          return { name: normalizeName(party.nombre), votes };
        }
        return best;
      }, { name: "", votes: -1 });
  }

  function getCurrentPartyVotes(region, partyNameNormalized) {
    const party = (region.partidos || []).find(
      item => normalizeName(item.nombre) === partyNameNormalized
    );
    return parseInt(party?.votos, 10) || 0;
  }

  function getTopRuralRegions(regions) {
    return regions.filter(region => getLeadingValidParty(region).name === SANCHEZ_PARTY);
  }

  function multiplierForParty(partyNameNormalized) {
    for (const tier of Object.values(RURAL_TIERS)) {
      if (tier.parties.has(partyNameNormalized)) return tier.multiplier;
    }
    return RURAL_MULTIPLIER_D;
  }

  function buildRuralValidProjection(region, baseProjectedByParty, multiplierResolver = multiplierForParty) {
    const validParties = (region.partidos || [])
      .filter(party => !isSpecial(party.nombre || ""))
      .map(party => ({
        name: (party.nombre || "").trim(),
        normalizedName: normalizeName(party.nombre),
        currentVotes: parseInt(party.votos, 10) || 0,
      }))
      .sort((a, b) => b.currentVotes - a.currentVotes);

    const currentValidTotal = validParties.reduce((sum, party) => sum + party.currentVotes, 0);
    const baseValidTotal = validParties.reduce(
      (sum, party) => sum + (baseProjectedByParty[party.name] || 0),
      0
    );
    const remainingValidVotes = Math.max(0, Math.round(baseValidTotal - currentValidTotal));

    if (!validParties.length || remainingValidVotes <= 0) {
      return Object.fromEntries(validParties.map(party => [party.name, party.currentVotes]));
    }

    const weightedGrowth = {};
    for (const party of validParties) {
      const baseProjectedVotes = baseProjectedByParty[party.name] || 0;
      const growthBase = Math.max(0, baseProjectedVotes - party.currentVotes);
      weightedGrowth[party.name] = growthBase * multiplierResolver(party.normalizedName);
    }

    const weightedGrowthTotal = Object.values(weightedGrowth).reduce((sum, value) => sum + value, 0);
    if (weightedGrowthTotal <= 0) {
      return Object.fromEntries(validParties.map(party => [party.name, party.currentVotes]));
    }

    const normalizedGrowth = {};
    for (const party of validParties) {
      normalizedGrowth[party.name] = (weightedGrowth[party.name] / weightedGrowthTotal) * remainingValidVotes;
    }

    const roundedGrowth = roundSharesToTotal(normalizedGrowth, remainingValidVotes);
    const finalProjection = {};
    for (const party of validParties) {
      finalProjection[party.name] = party.currentVotes + (roundedGrowth[party.name] || 0);
    }

    return finalProjection;
  }

  function accumulateVotes(target, votesByParty) {
    for (const [partyName, votes] of Object.entries(votesByParty)) {
      target[partyName] = (target[partyName] || 0) + votes;
    }
  }

  function buildCandidateStats(projectedByParty) {
    const projectedCandidates = Object.entries(projectedByParty)
      .filter(([name]) => !isSpecial(name))
      .sort((a, b) => b[1] - a[1]);

    const totalValidProjectedVotes = projectedCandidates.reduce(
      (sum, [, votes]) => sum + votes,
      0
    );

    return {
      projectedCandidates,
      totalValidProjectedVotes,
      topCandidates: projectedCandidates.slice(0, TOP_N),
    };
  }

  function buildNationalProjectionStats(latestPayload) {
    const regions = latestPayload.regions || [];
    let totalRemainingVotes = 0;
    const projectedByParty = {};

    for (const region of regions) {
      const regionProjection = buildRegionProjection(region);
      totalRemainingVotes += regionProjection.remainingVotes;
      accumulateVotes(projectedByParty, buildProjectedByParty(region, regionProjection.factor));
    }

    const candidateStats = buildCandidateStats(projectedByParty);
    const sanchezProjectedVotes = Object.entries(projectedByParty)
      .filter(([name]) => normalizeName(name) === SANCHEZ_PARTY)
      .reduce((sum, [, votes]) => sum + votes, 0);
    const rlaProjectedVotes = Object.entries(projectedByParty)
      .filter(([name]) => normalizeName(name) === "RENOVACION POPULAR")
      .reduce((sum, [, votes]) => sum + votes, 0);

    return {
      totalRemainingVotes,
      sanchezProjectedVotes,
      rlaProjectedVotes,
      totalValidProjectedVotes: candidateStats.totalValidProjectedVotes,
      sanchezValidPct: candidateStats.totalValidProjectedVotes > 0
        ? (sanchezProjectedVotes / candidateStats.totalValidProjectedVotes) * 100
        : 0,
      rlaValidPct: candidateStats.totalValidProjectedVotes > 0
        ? (rlaProjectedVotes / candidateStats.totalValidProjectedVotes) * 100
        : 0,
      projectedCandidates: candidateStats.projectedCandidates,
    };
  }

  function buildScenarioProjectionStats(latestPayload, multiplierResolver) {
    const regions = latestPayload.regions || [];
    const eligibleRegions = getTopRuralRegions(regions);
    const eligibleRegionNames = new Set(eligibleRegions.map(region => region.region || ""));
    const projectedByParty = {};
    let totalRemainingVotes = 0;

    for (const region of regions) {
      const regionProjection = buildRegionProjection(region);
      totalRemainingVotes += regionProjection.remainingVotes;
      const baseProjectedByParty = buildProjectedByParty(region, regionProjection.factor);

      if (!eligibleRegionNames.has(region.region || "")) {
        accumulateVotes(projectedByParty, baseProjectedByParty);
        continue;
      }

      const ruralValidProjection = buildRuralValidProjection(region, baseProjectedByParty, multiplierResolver);
      const mergedProjection = {};

      for (const party of region.partidos || []) {
        const partyName = (party.nombre || "").trim();
        if (!partyName) continue;
        mergedProjection[partyName] = isSpecial(partyName)
          ? baseProjectedByParty[partyName] || 0
          : ruralValidProjection[partyName] || 0;
      }

      accumulateVotes(projectedByParty, mergedProjection);
    }

    const candidateStats = buildCandidateStats(projectedByParty);

    return {
      totalRemainingVotes,
      projectedCandidates: candidateStats.projectedCandidates,
      totalValidProjectedVotes: candidateStats.totalValidProjectedVotes,
      eligibleRegionCount: eligibleRegions.length,
      isFallback: eligibleRegions.length === 0,
    };
  }

  function multiplierForPartyMegaRural(partyNameNormalized) {
    if (partyNameNormalized === SANCHEZ_PARTY) return 2;
    if (partyNameNormalized === RLA_PARTY) return 0.5;
    return multiplierForParty(partyNameNormalized);
  }

  function buildRuralProjectionStats(latestPayload) {
    return buildScenarioProjectionStats(latestPayload, multiplierForParty);
  }

  function buildMegaRuralProjectionStats(latestPayload) {
    return buildScenarioProjectionStats(latestPayload, multiplierForPartyMegaRural);
  }

  global.ProjectionModes = {
    buildNationalProjectionStats,
    buildRuralProjectionStats,
    buildMegaRuralProjectionStats,
  };
})(window);
