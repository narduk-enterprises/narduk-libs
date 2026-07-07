import {
  LAYER_BUNDLE_MANIFEST,
  normalizeTemplateLayerSelection,
  resolveRequiredAppDependencies,
  resolveSelectedLayerPackageNames,
  type TemplateLayerSelection,
} from './layer-bundle-manifest'

export interface StarterCompositionSelection {
  templateLayerSelection: TemplateLayerSelection
}

export interface NormalizedStarterCompositionSelection {
  templateLayerSelection: TemplateLayerSelection
}

function unique(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index)
}

export function normalizeStarterCompositionSelection(
  selection: StarterCompositionSelection,
): NormalizedStarterCompositionSelection {
  return {
    templateLayerSelection: normalizeTemplateLayerSelection(selection.templateLayerSelection),
  }
}

export function resolveSelectedStarterPackageNames(
  selection: StarterCompositionSelection,
): string[] {
  const normalized = normalizeStarterCompositionSelection(selection)
  const layerPackageNames = resolveSelectedLayerPackageNames(normalized.templateLayerSelection)
  const operatorLayerPackageName = LAYER_BUNDLE_MANIFEST.operator.packageName
  const orderedLayerPackageNames = layerPackageNames.includes(operatorLayerPackageName)
    ? [
        operatorLayerPackageName,
        ...layerPackageNames.filter((packageName) => packageName !== operatorLayerPackageName),
      ]
    : layerPackageNames

  return unique(orderedLayerPackageNames)
}

export function resolveSelectedStarterRequiredAppDependencies(
  selection: StarterCompositionSelection,
): string[] {
  const normalized = normalizeStarterCompositionSelection(selection)

  return unique(resolveRequiredAppDependencies(normalized.templateLayerSelection))
}
