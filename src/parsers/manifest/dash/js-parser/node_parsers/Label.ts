/**
 * Copyright 2015 CANAL+ Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { ILabelIntermediateRepresentation } from "../../node_parser_types";

/**
 * Parse Label element into a Label intermediate
 * representation.
 * @param {Element} adaptationSetElement - The Label root element.
 * @returns {Array.<Object|undefined>}
 */
export default function parseLabel(
  root: Element
): [ILabelIntermediateRepresentation | undefined, Error[]] {
  const value = root.textContent;

  const warnings: Error[] = [];
  if (value === null || value.length === 0) {
    return [undefined, warnings];
  }

  return [{ value }, warnings];
}
