import { it, assert, describe } from 'vitest';
import { html, parse, parseFragment, serialize, serializeOuter, type DefaultTreeAdapterMap } from 'parse5';
import { generateSerializerTests } from 'parse5-test-utils/utils/generate-serializer-tests.js';
import { treeAdapters, generateTestsForEachTreeAdapter } from 'parse5-test-utils/utils/common.js';

generateSerializerTests('serializer', 'Serializer', serialize);

describe('serializer', () => {
    describe("Regression - Get text node's parent tagName only if it's an Element node (GH-38)", () => {
        it('serializes correctly', () => {
            const document = parse('<template>yo<div></div>42</template>');
            const treeAdapter: typeof treeAdapters.default = {
                ...treeAdapters.default,
                getTagName: (element: DefaultTreeAdapterMap['element']) => {
                    assert.ok(element.tagName);

                    return treeAdapters.default.getTagName(element);
                },
            };

            serialize(document, { treeAdapter });
        });
    });

    describe('serializeOuter', () => {
        it('serializes outerHTML correctly', () => {
            const document = parseFragment('<div><button>Hello</button></div>');
            const div = document.childNodes[0];
            assert.ok(treeAdapters.default.isElementNode(div));
            const html = serializeOuter(div);

            assert.equal(html, '<div><button>Hello</button></div>');
        });
    });

    it('serializes <template> elements inner content', () => {
        const document = parseFragment('<template><button>Hello</button></template>');
        const template = document.childNodes[0];
        assert.ok(treeAdapters.default.isElementNode(template));
        const html = serialize(template);

        assert.equal(html, '<button>Hello</button>');
    });

    it('serializes the children of void elements as the empty string (GH-289)', () => {
        const br = treeAdapters.default.createElement('br', html.NS.HTML, []);

        // Add child node to `br`, to make sure they are skipped.
        treeAdapters.default.appendChild(br, treeAdapters.default.createElement('div', html.NS.HTML, []));

        assert.equal(serialize(br), '');

        // If the namespace is not HTML, the serializer should not skip the children.
        const svgBr = treeAdapters.default.createElement('br', html.NS.SVG, []);
        treeAdapters.default.appendChild(svgBr, treeAdapters.default.createElement('div', html.NS.HTML, []));

        assert.equal(serialize(svgBr), '<div></div>');
    });

    it('serializes unknown node to empty string', () => {
        const unknown = {} as never;
        assert.strictEqual(serialize(unknown), '');
        assert.strictEqual(serializeOuter(unknown), '');
    });

    describe('document type serialization', () => {
        // Round-trip matrix: identifier shape (none / public / system / both) x parse+serialize.
        it.each([
            // No identifiers: the legacy output must remain byte-for-byte unchanged.
            ['<!DOCTYPE html>', '<!DOCTYPE html>'],
            ['<!DOCTYPE>', '<!DOCTYPE >'],
            // Public identifier only.
            [
                '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN">',
                '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN">',
            ],
            // System identifier only requires the SYSTEM keyword.
            [
                '<!DOCTYPE html SYSTEM "http://www.w3.org/DTD/HTML4-strict.dtd">',
                '<!DOCTYPE html SYSTEM "http://www.w3.org/DTD/HTML4-strict.dtd">',
            ],
            // Both identifiers: SYSTEM keyword is omitted per the HTML spec.
            [
                '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">',
                '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">',
            ],
            // A legacy keyword-less form is parsed as a bogus doctype, so its identifiers cannot be restored.
            [
                '<!DOCTYPE html html "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">',
                '<!DOCTYPE html>',
            ],
        ])('preserves the document type declaration on round-trip: %j', (input, expectedDoctype) => {
            const document = parse(input);
            const output = serialize(document);

            assert.ok(
                output.startsWith(expectedDoctype),
                `Expected output to start with ${expectedDoctype}, got ${output}`,
            );

            // A second round-trip must be stable as well.
            const reparsed = parse(output);
            assert.equal(serialize(reparsed), output);
        });

        it('keeps the output of a doctype without identifiers byte-for-byte unchanged', () => {
            const input = '<!DOCTYPE html><html><head></head><body></body></html>';
            assert.equal(serialize(parse(input)), input);
        });

        it('preserves public and system identifiers through a parse+serialize round-trip', () => {
            const input =
                '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><html><head></head><body></body></html>';
            const document = parse(input);
            const output = serialize(document);

            assert.equal(output, input);

            const doctype = document.childNodes[0];
            assert.ok(treeAdapters.default.isDocumentTypeNode(doctype));
            assert.equal(
                treeAdapters.default.getDocumentTypeNodePublicId(doctype),
                '-//W3C//DTD XHTML 1.0 Transitional//EN',
            );
            assert.equal(
                treeAdapters.default.getDocumentTypeNodeSystemId(doctype),
                'http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd',
            );
        });

        it('serializes a doctype with a system identifier but no public identifier using the SYSTEM keyword', () => {
            const document = treeAdapters.default.createDocument();
            treeAdapters.default.setDocumentType(document, 'html', '', 'about:legacy-compat');

            assert.equal(serialize(document), '<!DOCTYPE html SYSTEM "about:legacy-compat">');
        });

        it('aligns quote handling of identifiers containing double quotes with the HTML spec', () => {
            // Identifiers always use double quotes; embedded double quotes are escaped as `&quot;`.
            const document = treeAdapters.default.createDocument();
            treeAdapters.default.setDocumentType(document, 'html', 'pub"lic', 'sys"tem');

            assert.equal(serialize(document), '<!DOCTYPE html PUBLIC "pub&quot;lic" "sys&quot;tem">');

            const systemOnly = treeAdapters.default.createDocument();
            treeAdapters.default.setDocumentType(systemOnly, 'html', '', 'sys"tem');

            assert.equal(serialize(systemOnly), '<!DOCTYPE html SYSTEM "sys&quot;tem">');
        });

        it('keeps the source code location of a full doctype declaration intact on round-trip', () => {
            const doctypeText =
                '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';
            const input = `${doctypeText}<body></body>`;
            const document = parse(input, { sourceCodeLocationInfo: true });
            const doctype = document.childNodes[0];
            assert.ok(treeAdapters.default.isDocumentTypeNode(doctype));

            // The location must cover the whole declaration, including both identifiers.
            assert.deepEqual(doctype.sourceCodeLocation, {
                startLine: 1,
                startCol: 1,
                startOffset: 0,
                endLine: 1,
                endCol: doctypeText.length + 1,
                endOffset: doctypeText.length,
            });
            assert.equal(input.slice(0, doctype.sourceCodeLocation!.endOffset), doctypeText);

            // The re-serialized declaration re-parses with an equivalent full-span location.
            const output = serialize(document);
            const reparsedDoctype = parse(output, { sourceCodeLocationInfo: true }).childNodes[0];
            assert.ok(treeAdapters.default.isDocumentTypeNode(reparsedDoctype));
            assert.equal(output.slice(0, reparsedDoctype.sourceCodeLocation!.endOffset), doctypeText);
        });
    });
});

generateTestsForEachTreeAdapter('deep serialization', (treeAdapter) => {
    it.each(['serialize', 'serializeOuter'])('%s does not recurse', (method) => {
        const opening = '<x>'.repeat(20_000);
        const fragment = parseFragment(`${opening}text`, { treeAdapter });
        const expected = `${opening}text${'</x>'.repeat(20_000)}`;
        const actual =
            method === 'serialize'
                ? serialize(fragment, { treeAdapter })
                : serializeOuter(treeAdapter.getChildNodes(fragment)[0], { treeAdapter });
        assert.equal(actual, expected);
    });
});
