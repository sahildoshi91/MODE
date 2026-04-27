import fs from 'fs';
import path from 'path';

describe('ClientContextRail source contract', () => {
  it('defines exactly one dismiss control in the expanded rail header', () => {
    const sourcePath = path.resolve(
      __dirname,
      '..',
      'ClientContextRail.js',
    );
    const source = fs.readFileSync(sourcePath, 'utf8');
    const dismissTestIdMatches = source.match(/`\$\{testIDPrefix\}-dismiss`/g) || [];

    expect(dismissTestIdMatches).toHaveLength(1);
    expect(source).toContain('onPress={() => actions?.dismissRail?.()}');
  });

  it('keeps the quick client sheet compact without duplicated context headings', () => {
    const sourcePath = path.resolve(
      __dirname,
      '..',
      'ClientContextRail.js',
    );
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toContain('Client Context');
    expect(source).not.toContain('ContextSettingsShortcuts');
    expect(source.indexOf('<QuickNoteComposer')).toBeLessThan(source.indexOf('<SmartClientPicker'));
  });
});
