import { useAnimationLoop } from './animationLoop'

const COMPATIBLE_MAJOR_VERSION = 1

type Attributes = { [key: string]: string | number } | null

export interface ElementNode {
  id: string
  tag: string
  attributes: { [name: string]: string }
  children: (ElementNode | string)[]
}

interface Action {
  name: string
  attributesMapPerFrame: { [elementId: string]: { [name: string]: string } }[]
}

interface BakedData {
  version: string
  appVersion: string
  actions: Action[]
  svgTree: ElementNode
}

interface Props {
  bakedData: BakedData
  width?: number | string
  height?: number | string
}

const SVG_URL = 'http://www.w3.org/2000/svg'

function checkVersion(version: string): boolean {
  const major = parseInt(version.split('.')[0])
  return COMPATIBLE_MAJOR_VERSION === major
}

export class Player {
  private $el: Element | undefined
  private bakedData: BakedData
  private width: number | string
  private height: number | string

  private $svg: SVGElement | undefined
  private animationLoop: ReturnType<typeof useAnimationLoop> | undefined
  private currentFrame: number
  private reversed: boolean
  private oneshot: boolean
  private currentActionName: string

  private actionsByName: { [name: string]: Action }

  constructor(el: string | Element, props: Props) {
    if (typeof el === 'string') {
      const $el = document.getElementById(el)
      if (!$el) throw new Error('Not found element: ' + el)
      this.$el = $el
    } else {
      this.$el = el
    }

    this.bakedData = props.bakedData
    this.actionsByName = this.bakedData.actions.reduce<{
      [name: string]: Action
    }>((p, action) => {
      p[action.name] = action
      return p
    }, {})
    this.currentActionName = this.bakedData.actions[0]?.name ?? ''

    if (!checkVersion(this.bakedData.version)) {
      throw new Error(
        `Version mismatch. Player Major: ${COMPATIBLE_MAJOR_VERSION}, Data: ${this.bakedData.version}`
      )
    }

    this.width = props.width ?? 0
    this.height = props.height ?? 0

    this.currentFrame = 0
    this.reversed = false
    this.oneshot = false
    this.mount()
  }

  getActionList(): { name: string; endFrame: number }[] {
    return this.bakedData.actions.map((a) => ({
      name: a.name,
      endFrame: a.attributesMapPerFrame.length - 1,
    }))
  }

  getCurrentActionName(): string {
    return this.currentActionName
  }

  setCurrentActionName(name: string) {
    if (name in this.actionsByName) {
      this.currentActionName = name
      this.currentFrame = Math.min(this.currentFrame, this.endFrame)
      this.render()
    } else {
      throw new Error('Not found the action.')
    }
  }

  private get currentAction(): Action | undefined {
    return this.actionsByName[this.currentActionName]
  }

  private get endFrame(): number {
    return (this.currentAction?.attributesMapPerFrame.length ?? 1) - 1
  }

  private mount() {
    if (!this.$el) return

    const $svg = renderNode({
      ...this.bakedData.svgTree,
      attributes: {
        ...this.bakedData.svgTree.attributes,
        width: this.width
          ? this.width.toString()
          : this.bakedData.svgTree.attributes.width,
        height: this.height
          ? this.height.toString()
          : this.bakedData.svgTree.attributes.height,
      },
    })
    this.$el.append($svg)
    this.$svg = $svg
    this.render()
  }

  private render() {
    if (!this.$el || !this.$svg || !this.currentAction) return

    this.$svg.innerHTML = ''

    const posedSvgNode = applyTransform(
      this.currentAction.attributesMapPerFrame[this.currentFrame],
      this.bakedData.svgTree
    )

    const $svg = renderNode(posedSvgNode)
    Object.keys(posedSvgNode.attributes).forEach((name) => {
      // drop original size attributes and use this class's size
      if (['width', 'height'].includes(name)) return
      setAttribute(this.$svg!, name, posedSvgNode.attributes[name])
    })
    appendChildren(this.$svg, Array.from($svg.children))
  }

  private tick(tickFrame: number) {
    if (this.reversed) {
      const val = this.currentFrame - tickFrame
      if (0 < val) {
        this.currentFrame = val
      } else {
        if (this.oneshot) {
          this.currentFrame = 0
          this.pause()
        } else {
          this.currentFrame = this.endFrame
        }
      }
    } else {
      const val = this.currentFrame + tickFrame
      if (val < this.endFrame) {
        this.currentFrame = val
      } else {
        if (this.oneshot) {
          this.currentFrame = this.endFrame
          this.pause()
        } else {
          this.currentFrame = 0
        }
      }
    }
    this.render()
  }

  reverse(oneshot = false) {
    if (this.animationLoop) {
      this.pause()
    }
    this.reversed = true
    this.oneshot = oneshot
    this.animationLoop = useAnimationLoop((tickFrame) => this.tick(tickFrame))
    this.animationLoop.begin()
  }

  play(oneshot = false) {
    if (this.animationLoop) {
      this.pause()
    }
    this.reversed = false
    this.oneshot = oneshot
    this.animationLoop = useAnimationLoop((tickFrame) => this.tick(tickFrame))
    this.animationLoop.begin()
  }

  pause() {
    if (this.animationLoop) {
      this.animationLoop.stop()
      this.animationLoop = undefined
    }
  }

  stop() {
    if (this.animationLoop) {
      this.animationLoop.stop()
      this.animationLoop = undefined
    }
    this.currentFrame = 0
    this.render()
  }

  dispose() {
    if (this.$el && this.$svg) {
      this.$el.removeChild(this.$svg)
    }

    this.$el = undefined
    this.$svg = undefined
  }
}

function renderNode(node: ElementNode): SVGElement {
  return createSVGElement(
    node.tag,
    {
      ...node.attributes,
      style:
        (node.attributes.style ? node.attributes.style + ';' : '') +
        getExtraStyle(node),
    },
    node.children.map((n) => {
      if (typeof n === 'string') return n
      return renderNode(n)
    })
  )
}

export function createSVGElement(
  tag: string,
  attributes: Attributes = null,
  children: (Element | string)[] = []
): SVGElement {
  const $el = document.createElementNS(SVG_URL, tag)
  return createElement($el, attributes, children)
}

function getExtraStyle(node: ElementNode): string {
  const ret: string[] = []

  if (node.attributes.fill) {
    ret.push(`fill:${node.attributes.fill}`)
  }
  if (node.attributes.stroke) {
    ret.push(`stroke:${node.attributes.stroke}`)
  }

  return (
    (node.attributes.style ? node.attributes.style + ';' : '') + ret.join(';')
  )
}

function setAttribute($el: Element, name: string, value: string) {
  return $el.setAttribute(name, value)
}

function createElement<T extends Element>(
  $el: T,
  attributes: Attributes = null,
  children: (Element | string)[] = []
): T {
  for (const key in attributes) {
    setAttribute($el, key, attributes[key].toString())
  }
  if (Array.isArray(children)) {
    appendChildren($el, children)
  } else {
    $el.textContent = children
  }
  return $el
}

function appendChildren($el: Element, children: (Element | string)[]) {
  const $fragment = document.createDocumentFragment()
  for (let i = 0; i < children.length; i++) {
    const item = children[i]
    if (typeof item === 'string') {
      $fragment.appendChild(new Text(item))
    } else {
      $fragment.appendChild(item)
    }
  }
  $el.appendChild($fragment)
}

function applyTransform(
  attributesMap: { [elementId: string]: { [name: string]: string } },
  node: ElementNode
): ElementNode {
  return {
    ...node,
    attributes: {
      ...node.attributes,
      ...(attributesMap[node.id] ?? {}),
    },
    children: node.children.map((c) => {
      if (typeof c === 'string') return c
      return applyTransform(attributesMap, c)
    }),
  }
}