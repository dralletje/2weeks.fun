import ALL_HEADS from "./ALL_HEADS.json" with { type: "json" };

let heads_raw = ALL_HEADS as Array<{
  name: string;
  uuid: string;
  value: string;
  tags: string;
}>;

export let heads = heads_raw
  .filter((x) => x.name && x.value)
  .map((x) => {
    return {
      name: x.name,
      uuid: x.uuid,
      value: x.value,
      tags: x.tags?.split(",").map((x) => x.trim().toLowerCase()) ?? [],
    };
  });

let filter_with_max = <T>(
  max: number,
  haystack: Array<T>,
  filter: (needle: T) => boolean
) => {
  let result: Array<T> = [];
  for (let needle of haystack) {
    if (filter(needle)) {
      result.push(needle);
      if (result.length >= max) {
        return result;
      }
    }
  }
  return result;
};

export let search_heads = (
  search: string,
  { pagesize = 9 * 3, page = 0 }: { pagesize?: number; page?: number }
) => {
  let search_lower = search.toLowerCase();
  return filter_with_max(
    (page + 1) * pagesize,
    heads,
    (x) =>
      x.name.toLowerCase().includes(search_lower) ||
      x.tags.includes(search_lower)
  ).slice(page * pagesize, (page + 1) * pagesize);
};

// let filter_with_max = <T>(
//   max: number,
//   cursor: number,
//   haystack: Array<T>,
//   filter: (needle: T) => boolean
// ) => {
//   let result: Array<T> = [];

//   let index = 0;
//   for (let needle of haystack.slice(cursor)) {
//     index++;
//     if (filter(needle)) {
//       result.push(needle);
//       if (result.length >= max) {
//         return {
//           results: result,
//           cursor: cursor + index,
//           has_more: true,
//         };
//       }
//     }
//   }
//   return {
//     results: result,
//     cursor: cursor + index,
//     has_more: false,
//   };
// };

// export let search_heads = (
//   search: string,
//   { pagesize = 9 * 3, cursor = 0 }: { pagesize?: number; cursor?: number }
// ) => {
//   if (search === "") {
//     let results = heads.slice(cursor, cursor + pagesize);
//     return {
//       heads: results,
//       cursor: results.length,
//       has_more: heads.length > cursor + pagesize,
//     };
//   } else {
//     let search_lower = search.toLowerCase();
//     let results = filter_with_max(
//       pagesize,
//       cursor,
//       heads,
//       (x) =>
//         x.name.toLowerCase().includes(search_lower) ||
//         x.tags.includes(search_lower)
//     );
//     return {
//       heads: results.results,
//       cursor: results.cursor,
//       has_more: results.has_more,
//     };
//   }
// };
