export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeDimension(dimension = {}) {
  return {
    label: String(dimension?.label || '').trim(),
    enabled: dimension?.enabled !== false,
    price: Number(dimension?.price) || 0
  };
}

export function buildDimensionList(dimensions = []) {
  return (Array.isArray(dimensions) ? dimensions : [])
    .map((item) => normalizeDimension(item))
    .filter((item) => item.label);
}

export function normalizePaper(paper = {}, fallbackDimensions = []) {
  const dimensions = Array.isArray(paper?.dimensions) && paper.dimensions.length
    ? buildDimensionList(paper.dimensions)
    : buildDimensionList(fallbackDimensions);

  return {
    label: String(paper?.label || '').trim(),
    enabled: paper?.enabled !== false,
    dimensions
  };
}

export function collectUniqueDimensionsFromPapers(papers = [], fallbackDimensions = []) {
  const map = new Map();

  (Array.isArray(papers) ? papers : []).forEach((paper) => {
    (Array.isArray(paper?.dimensions) ? paper.dimensions : []).forEach((dimension) => {
      const normalized = normalizeDimension(dimension);
      if (!normalized.label || map.has(normalized.label)) return;
      map.set(normalized.label, normalized);
    });
  });

  if (map.size) {
    return Array.from(map.values());
  }

  return buildDimensionList(fallbackDimensions);
}

export function normalizePrintingConfig(defaultConfig, data = {}) {
  const defaults = deepClone(defaultConfig);
  const fallbackDimensions = collectUniqueDimensionsFromPapers(defaults.papers || [], defaults.dimensions || []);
  const legacyDimensions = Array.isArray(data?.dimensions) && data.dimensions.length
    ? buildDimensionList(data.dimensions)
    : fallbackDimensions;
  const papersSource = Array.isArray(data?.papers) && data.papers.length
    ? data.papers
    : (defaults.papers || []);
  const papers = papersSource
    .map((paper) => normalizePaper(paper, legacyDimensions))
    .filter((paper) => paper.label);

  return {
    ...defaults,
    ...data,
    papers,
    dimensions: collectUniqueDimensionsFromPapers(papers, legacyDimensions),
    pricing: {
      ...(defaults.pricing || {}),
      ...(data?.pricing || {})
    }
  };
}
