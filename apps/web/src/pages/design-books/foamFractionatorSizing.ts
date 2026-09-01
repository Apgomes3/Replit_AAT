export const FOAM_RECOMMENDED_PROCESS_RATE_LS_M2 = 20;
export const FOAM_PROCESS_RATE_SLIDER_MIN = 10;
export const FOAM_PROCESS_RATE_SLIDER_MAX = 30;
export const SAND_FILTER_RECOMMENDED_PROCESS_RATE_LS_M2 = 6;
export const SAND_FILTER_PROCESS_RATE_SLIDER_MIN = 1;
export const SAND_FILTER_PROCESS_RATE_SLIDER_MAX = 12;

export function calculateFoamFractionatorSizingRecommendation(
  parentLoopFlowM3h: unknown,
  products: any[],
  currentRate?: unknown,
) {
  const parentFlowM3h = Number(parentLoopFlowM3h);
  if (!Number.isFinite(parentFlowM3h) || parentFlowM3h <= 0) {
    return {
      status: 'incomplete' as const,
      reason: 'Set the parent loop allocation above zero to size the fractionator.',
    };
  }
  if (!Array.isArray(products) || products.length === 0) {
    return {
      status: 'incomplete' as const,
      reason: 'Select a Foam Fractionator to see sizing guidance.',
    };
  }
  const productRecommendations = products.map(product => {
    const diameterMm = Number(product?.diameter_mm);
    const unitAreaM2 = diameterMm > 0 ? Math.PI * Math.pow(diameterMm / 2000, 2) : null;
    const quantity = Number(product?.quantity);
    return {
      ...product,
      diameter_mm: Number.isFinite(diameterMm) && diameterMm > 0 ? diameterMm : null,
      unitAreaM2,
      quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : 0,
      suggestedQuantity: unitAreaM2
        ? Math.max(1, Math.ceil((parentFlowM3h / 3.6) /
          (FOAM_RECOMMENDED_PROCESS_RATE_LS_M2 * unitAreaM2)))
        : null,
    };
  });
  if (productRecommendations.some(product => product.unitAreaM2 == null)) {
    return {
      status: 'incomplete' as const,
      reason: 'A selected fractionator has no valid saved diameter.',
      products: productRecommendations,
    };
  }

  const parentFlowLs = parentFlowM3h / 3.6;
  const requiredAreaM2 = parentFlowLs / FOAM_RECOMMENDED_PROCESS_RATE_LS_M2;
  const selectedAreaM2 = productRecommendations.reduce(
    (sum, product) => sum + (product.unitAreaM2 as number) * product.quantity,
    0,
  );
  const recommendedCapacityLs = selectedAreaM2 * FOAM_RECOMMENDED_PROCESS_RATE_LS_M2;
  const selectedRate = Number(currentRate);
  const selectedCapacityLs = selectedRate > 0 && Number.isFinite(selectedRate)
    ? selectedAreaM2 * selectedRate
    : null;
  const tolerance = Math.max(parentFlowLs, recommendedCapacityLs) * 0.05;
  const coverageStatus = recommendedCapacityLs < parentFlowLs - tolerance
    ? 'below' as const
    : recommendedCapacityLs > parentFlowLs + tolerance
      ? 'above' as const
      : 'near' as const;

  return {
    status: 'ready' as const,
    recommendedRateLsM2: FOAM_RECOMMENDED_PROCESS_RATE_LS_M2,
    parentFlowLs,
    requiredAreaM2,
    selectedAreaM2,
    recommendedCapacityLs,
    selectedCapacityLs,
    coverageStatus,
    products: productRecommendations,
  };
}

export function calculateSandFilterSizingRecommendation(
  parentLoopFlowM3h: unknown,
  products: any[],
  currentRate?: unknown,
) {
  const result = calculateEquipmentSizingRecommendation(
    parentLoopFlowM3h, products, currentRate,
    SAND_FILTER_RECOMMENDED_PROCESS_RATE_LS_M2,
    'Set the parent loop allocation above zero to size the Sand Filter.',
    'Select an AAT Sand Filter to see sizing guidance.',
    'A selected Sand Filter has no valid saved diameter.',
  );
  return result;
}

function calculateEquipmentSizingRecommendation(
  parentLoopFlowM3h: unknown,
  products: any[],
  currentRate: unknown,
  recommendedRate: number,
  flowReason: string,
  selectionReason: string,
  diameterReason: string,
) {
  const parentFlow = Number(parentLoopFlowM3h);
  if (!Number.isFinite(parentFlow) || parentFlow <= 0) return { status: 'incomplete' as const, reason: flowReason };
  if (!Array.isArray(products) || !products.length) return { status: 'incomplete' as const, reason: selectionReason };
  const recommendations = products.map(product => {
    const diameter = Number(product.diameter_mm);
    const area = diameter > 0 ? Math.PI * Math.pow(diameter / 2000, 2) : null;
    const quantity = Number(product.quantity);
    return { ...product, unitAreaM2: area, quantity,
      suggestedQuantity: area ? Math.max(1, Math.ceil((parentFlow / 3.6) / (recommendedRate * area))) : null };
  });
  if (recommendations.some(product => !product.unitAreaM2)) {
    return { status: 'incomplete' as const, reason: diameterReason, products: recommendations };
  }
  if (recommendations.some(product => !Number.isInteger(product.quantity) || product.quantity <= 0)) {
    return {
      status: 'incomplete' as const,
      reason: 'Enter a positive whole-number quantity for each selected Sand Filter.',
      products: recommendations,
    };
  }
  const parentFlowLs = parentFlow / 3.6;
  const selectedAreaM2 = recommendations.reduce((sum, product) => sum + product.unitAreaM2! * product.quantity, 0);
  const capacity = selectedAreaM2 * recommendedRate;
  const tolerance = Math.max(parentFlowLs, capacity) * .05;
  return {
    status: 'ready' as const, recommendedRateLsM2: recommendedRate, parentFlowLs,
    requiredAreaM2: parentFlowLs / recommendedRate, selectedAreaM2,
    recommendedCapacityLs: capacity,
    selectedCapacityLs: Number(currentRate) > 0 ? selectedAreaM2 * Number(currentRate) : null,
    coverageStatus: capacity < parentFlowLs - tolerance ? 'below' as const
      : capacity > parentFlowLs + tolerance ? 'above' as const : 'near' as const,
    products: recommendations,
  };
}