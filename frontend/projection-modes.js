(function attachProjectionModes(global) {
  const TOP_N = 6;
  const TOP_RURAL_REGIONS = 10;
  const SANCHEZ_PARTY = "JUNTOS POR EL PERU";

  // Ratios Rural/Urbano del cuadro fuente (data/ratio.png).
  // Cualquier lista no explícita cae a "OTROS".
  const RURAL_URBAN_RATIOS = {
    FUERZA_POPULAR: 15.9 / 17.4,
    JUNTOS_POR_EL_PERU: 33.8 / 7.9,
    RENOVACION_POPULAR: 3.0 / 13.1,
    PARTIDO_DEL_BUEN_GOBIERNO: 2.9 / 12.3,
    PARTIDO_CIVICO_OBRAS: 11.8 / 9.8,
    PARTIDO_PAIS_PARA_TODOS: 3.5 / 8.9,
    AHORA_NACION_AN: 7.0 / 7.5,
    OTROS: 22.1 / 23.1,
  };

  const RURAL_RATIO_BY_PARTY = {
    [SANCHEZ_PARTY]: RURAL_URBAN_RATIOS.JUNTOS_POR_EL_PERU,
    FUERZA_POPULAR: RURAL_URBAN_RATIOS.FUERZA_POPULAR,
    RENOVACION_POPULAR: RURAL_URBAN_RATIOS.RENOVACION_POPULAR,
    PARTIDO_DEL_BUEN_GOBIERNO: RURAL_URBAN_RATIOS.PARTIDO_DEL_BUEN_GOBIERNO,
    PARTIDO_CIVICO_OBRAS: RURAL_URBAN_RATIOS.PARTIDO_CIVICO_OBRAS,
    PARTIDO_PAIS_PARA_TODOS: RURAL_URBAN_RATIOS.PARTIDO_PAIS_PARA_TODOS,
    "AHORA NACION - AN": RURAL_URBAN_RATIOS.AHORA_NACION_AN,
  };

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
    return regions
      .filter(region => getLeadingValidParty(region).name === SANCHEZ_PARTY)
      .sort(
        (a, b) =>
          getCurrentPartyVotes(b, SANCHEZ_PARTY) - getCurrentPartyVotes(a, SANCHEZ_PARTY)
      )
      .slice(0, TOP_RURAL_REGIONS);
  }

  function multiplierForParty(partyNameNormalized) {
    return RURAL_RATIO_BY_PARTY[partyNameNormalized] || RURAL_URBAN_RATIOS.OTROS;
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

  function buildRuralProjectionStats(latestPayload) {
    return buildScenarioProjectionStats(latestPayload, multiplierForParty);
  }

  global.ProjectionModes = {
    buildNationalProjectionStats,
    buildRuralProjectionStats,
  };
})(window);
