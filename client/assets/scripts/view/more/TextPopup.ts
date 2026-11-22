import { Label, Node } from 'cc';
import { makeLabel, setLabel } from '../ui/UiKit';
import { alignedLabel, popup, skinButton, SkinButton } from '../ui/Widgets';

const LINES_PER_PAGE = 22;
const CHARS_PER_LINE = 26;

/** 长文本弹窗（用户协议、隐私政策）：按行分页，上一页 / 下一页。 */
export class TextPopup {
  static open(parent: Node, title: string, text: string, onClose: () => void): TextPopup {
    return new TextPopup(parent, title, text, onClose);
  }

  private pages: string[];
  private page = 0;
  private label: Label;
  private pageL: Label;
  private prev: SkinButton;
  private next: SkinButton;

  private constructor(parent: Node, title: string, text: string, onClose: () => void) {
    const pop = popup(parent, title, 680, 1120, onClose);
    this.pages = paginate(text);
    this.label = alignedLabel(pop.body, '', 22, '#4a2f27', -292, 40, 'left');
    this.label.horizontalAlign = Label.HorizontalAlign.LEFT;
    this.label.lineHeight = 36;
    this.pageL = makeLabel(pop.body, '', 22, '#8a6d55', 0, -440);
    this.prev = skinButton(pop.body, 'btn_ink', '上一页', 200, 76, () => this.go(-1), -200, -440);
    this.next = skinButton(pop.body, 'btn_ink', '下一页', 200, 76, () => this.go(1), 200, -440);
    this.go(0);
  }

  private go(d: number): void {
    this.page = Math.max(0, Math.min(this.pages.length - 1, this.page + d));
    setLabel(this.label, this.pages[this.page]);
    setLabel(this.pageL, `${this.page + 1}/${this.pages.length}`);
    this.prev.setEnabled(this.page > 0);
    this.next.setEnabled(this.page < this.pages.length - 1);
  }
}

/** 按宽度折行，再按行数分页。 */
function paginate(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    if (!raw) {
      lines.push('');
      continue;
    }
    for (let i = 0; i < raw.length; i += CHARS_PER_LINE) lines.push(raw.slice(i, i + CHARS_PER_LINE));
  }
  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) pages.push(lines.slice(i, i + LINES_PER_PAGE).join('\n'));
  return pages.length ? pages : [''];
}
