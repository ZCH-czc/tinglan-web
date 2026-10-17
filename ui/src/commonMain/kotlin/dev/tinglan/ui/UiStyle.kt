package dev.tinglan.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.platform.LocalFontFamilyResolver
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.Font
import dev.tinglan.ui.generated.resources.Res
import dev.tinglan.ui.generated.resources.noto_sans_sc
import dev.tinglan.ui.generated.resources.noto_serif_sc
import dev.tinglan.ui.generated.resources.lxgw_wenkai_lite
import dev.tinglan.ui.generated.resources.nunito_variable
import dev.tinglan.ui.generated.resources.noto_color_emoji

/** One clipped state fill: selection stays steady while the pointer moves across the card. */
@Composable internal fun FlatSelectableSurface(
    selected: Boolean,
    shape: Shape,
    color: Color,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
    content: @Composable () -> Unit,
) {
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.collectIsPressedAsState()
    val hovered by interactions.collectIsHoveredAsState()
    val focused by interactions.collectIsFocusedAsState()
    val keyboard = LocalInputModeManager.current.inputMode == InputMode.Keyboard
    val accent = MaterialTheme.colorScheme.primary
    val strength = when {
        !enabled -> 0f
        pressed -> if (selected) .09f else .055f
        selected -> .06f
        hovered -> .025f
        else -> 0f
    }
    // Interpolating RGB from transparent black would create a grey veil on navigation.
    val target = if (color.alpha == 0f) accent.copy(alpha=strength) else lerp(color, accent, strength)
    val fill by animateColorAsState(target, tween(if (model.reduced) 0 else 90), label="card-state")
    Surface(
        modifier=modifier.clip(shape).semantics { this.selected=selected }.clickable(
            interactionSource=interactions, indication=null, role=Role.Button, enabled=enabled, onClick=onClick,
        ),
        shape=shape, color=fill, tonalElevation=0.dp, shadowElevation=0.dp,
        border=if (focused && keyboard) BorderStroke(1.dp, accent.copy(alpha=.65f)) else null,
        content=content,
    )
}

/** Both canvases use the same cached font resource and type scale. */
@OptIn(ExperimentalTextApi::class)
@Composable fun applicationTypography(): Typography {
    val fallback=Font(Res.font.noto_sans_sc)
    // Skia cannot use the operating system's emoji fonts. Register a bundled
    // fallback in each canvas resolver instead of depending on Google font CDNs.
    val emoji=Font(Res.font.noto_color_emoji)
    val resolver=LocalFontFamilyResolver.current
    LaunchedEffect(resolver,emoji) {resolver.preload(FontFamily(emoji))}
    val font=Font(when(model.font){"serif"->Res.font.noto_serif_sc;"wenkai"->Res.font.lxgw_wenkai_lite;"nunito"->Res.font.nunito_variable;else->Res.font.noto_sans_sc})
    val family=remember(font,fallback) {if(model.font=="nunito")FontFamily(font,fallback)else FontFamily(font)}
    return remember(family) {
        val b=Typography()
        Typography(
            displayLarge=b.displayLarge.copy(fontFamily=family),displayMedium=b.displayMedium.copy(fontFamily=family),displaySmall=b.displaySmall.copy(fontFamily=family),
            headlineLarge=b.headlineLarge.copy(fontFamily=family),headlineMedium=b.headlineMedium.copy(fontFamily=family),headlineSmall=b.headlineSmall.copy(fontFamily=family),
            titleLarge=b.titleLarge.copy(fontFamily=family),titleMedium=b.titleMedium.copy(fontFamily=family),titleSmall=b.titleSmall.copy(fontFamily=family),
            bodyLarge=b.bodyLarge.copy(fontFamily=family),bodyMedium=b.bodyMedium.copy(fontFamily=family),bodySmall=b.bodySmall.copy(fontFamily=family),
            labelLarge=b.labelLarge.copy(fontFamily=family),labelMedium=b.labelMedium.copy(fontFamily=family),labelSmall=b.labelSmall.copy(fontFamily=family),
        )
    }
}
