import { Fragment } from "react";

/**
 * Text from the dictionary with `<b>…</b>` around the parts that should be bold.
 *
 * Word order differs between languages, so a sentence with a bold number in the
 * middle cannot be built from fixed JSX pieces. The dictionary holds the whole
 * sentence, and this turns the `<b>` markers into real elements. Nothing is ever
 * interpreted as HTML: the text is split on the markers and every piece is rendered
 * as plain text, so a value containing `<script>` shows up as literal text.
 * Do not put user-written text inside a `<b>` sentence unless that is intended.
 */
export function Rich({ text }: { text: string }) {
  const pieces = text.split(/<b>(.*?)<\/b>/g);
  return (
    <>
      {pieces.map((piece, index) =>
        index % 2 === 1 ? <strong key={index}>{piece}</strong> : <Fragment key={index}>{piece}</Fragment>,
      )}
    </>
  );
}
