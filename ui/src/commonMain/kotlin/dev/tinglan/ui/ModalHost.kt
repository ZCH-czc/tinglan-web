@file:OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
package dev.tinglan.ui

import androidx.compose.animation.*
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.focus.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.*
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.*

private var nextModalId=0
private class ModalEntry(
    val content:State<@Composable (String)->Unit>,
    val dismiss:State<()->Unit>,
    val style:State<ModalStyle>,
) {
    val tag="tinglan-modal-${++nextModalId}"
    val focus=FocusRequester()
    val visibility=MutableTransitionState(false).apply {targetState=true}
    var closing by mutableStateOf(false)
}
private data class ModalStyle(val width:Dp,val shape:Shape,val color:Color,val alignment:Alignment,val fullHeight:Boolean,val fromBottom:Boolean,val dim:Boolean)
private class ModalOwner {
    val entries=mutableStateListOf<ModalEntry>()
    val background=FocusRequester()
    fun add(entry:ModalEntry) {
        // A replacement dialog must not retain fading input surfaces or stale focus requests.
        entries.removeAll {it.closing}
        (entries.lastOrNull()?.focus ?: background).saveFocusedChild()
        entries.add(entry)
    }
    fun close(entry:ModalEntry) {entry.closing=true;entry.visibility.targetState=false}
}
private val LocalModalOwner=staticCompositionLocalOf<ModalOwner> {error("Missing TinglanModalHost")}

/** Keep overlays in the same scene: Compose Web's separate Dialog scene loses the underlying
 * semantics owner on removal. One host also keeps pointer coordinates, focus and scrolling aligned. */
@Composable internal fun TinglanModalHost(rootId:String,content:@Composable ()->Unit) {
    val owner=remember {ModalOwner()}
    val focusManager=LocalFocusManager.current
    val blocked=owner.entries.isNotEmpty()
    val top=owner.entries.lastOrNull { !it.closing }
    var hadModal by remember {mutableStateOf(false)}
    DisposableEffect(rootId,blocked) {
        command("modal-state",payload("root" to rootId,"active" to blocked.toString()))
        onDispose {command("modal-state",payload("root" to rootId,"active" to "false"))}
    }
    LaunchedEffect(top?.tag,blocked) {
        withFrameNanos { }
        if(top!=null && owner.entries.lastOrNull { !it.closing }===top) {
            hadModal=true
            if(!top.focus.restoreFocusedChild())top.focus.requestFocus()
        } else if(!blocked && hadModal) {
            hadModal=false
            if(!owner.background.restoreFocusedChild())owner.background.requestFocus()
        }
    }
    CompositionLocalProvider(LocalModalOwner provides owner) {
        Box(Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxSize().focusRequester(owner.background).focusProperties {
                onEnter={if(blocked)cancelFocusChange()}
            }.focusGroup().then(if(blocked)Modifier.clearAndSetSemantics {} else Modifier)) {content()}
            owner.entries.toList().forEach {entry -> key(entry.tag) {
                val active=entry===top
                LaunchedEffect(entry.visibility.isIdle,entry.visibility.currentState,entry.closing) {
                    if(entry.closing && entry.visibility.isIdle && !entry.visibility.currentState)owner.entries.remove(entry)
                }
                AnimatedVisibility(entry.visibility,
                    enter=if(entry.style.value.fromBottom)fadeIn(tween(if(model.reduced)0 else 110))else fadeIn(tween(if(model.reduced)0 else 110))+scaleIn(tween(if(model.reduced)0 else 140),initialScale=.98f),
                    exit=fadeOut(tween(if(model.reduced)0 else 90)),
                ) {
                    val style=entry.style.value
                    Box(Modifier.fillMaxSize().then(if(!active)Modifier.clearAndSetSemantics {}.pointerInput(Unit) {
                        awaitPointerEventScope {while(true)awaitPointerEvent(PointerEventPass.Initial).changes.forEach {it.consume()}}
                    } else Modifier),contentAlignment=style.alignment) {
                        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha=if(style.dim).32f else 0f)).clickable(
                            indication=null,interactionSource=remember {MutableInteractionSource()},onClick={if(active)entry.dismiss.value()}
                        ).pointerInput(Unit) {
                            awaitPointerEventScope {while(true) {val event=awaitPointerEvent();if(event.type==PointerEventType.Scroll)event.changes.forEach {it.consume()}}}
                        }.clearAndSetSemantics {})
                        val sizing=if(style.fullHeight)Modifier.widthIn(max=style.width).fillMaxWidth().fillMaxHeight()
                            else if(style.fromBottom)Modifier.padding(top=24.dp).widthIn(max=style.width).fillMaxWidth()
                            else Modifier.padding(24.dp).widthIn(max=style.width).fillMaxWidth()
                        CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides 48.dp) {
                            Surface(modifier=sizing.then(if(style.fromBottom)Modifier.animateEnterExit(
                                enter=slideInVertically(tween(if(model.reduced)0 else 240,easing=androidx.compose.animation.core.CubicBezierEasing(.2f,0f,0f,1f))){it},
                                exit=slideOutVertically(tween(if(model.reduced)0 else 180)){it},
                            )else Modifier).testTag(entry.tag).semantics {dialog();isTraversalGroup=true}
                                .focusRequester(entry.focus).focusProperties {
                                    onEnter={if(!active)cancelFocusChange()}
                                    onExit={if(requestedFocusDirection==FocusDirection.Next || requestedFocusDirection==FocusDirection.Previous)cancelFocusChange()}
                                }.focusGroup().onPreviewKeyEvent {event ->
                                    if(!active)true
                                    else if(event.key==Key.Escape) {if(event.type==KeyEventType.KeyUp)entry.dismiss.value();true}
                                    else if(event.key==Key.Tab) {
                                        if(event.type==KeyEventType.KeyDown) {
                                            val direction=if(event.isShiftPressed)FocusDirection.Previous else FocusDirection.Next
                                            if(!focusManager.moveFocus(direction)) {
                                                // Requesting Next/Previous on a non-focusable group is
                                                // invalid in Compose's 2-D child search. Enter from
                                                // the top/bottom instead, retaining the canvas focus.
                                                entry.focus.requestFocus(if(event.isShiftPressed)FocusDirection.Up else FocusDirection.Down)
                                            }
                                        };true
                                    } else false
                                }.pointerInput(Unit) {
                                    // Occupy the card's hit region without consuming child button/editor gestures.
                                    awaitPointerEventScope {while(true)awaitPointerEvent()}
                                },shape=style.shape,color=style.color,tonalElevation=0.dp,shadowElevation=0.dp,
                            ) {entry.content.value(entry.tag+"-title")}
                        }
                    }
                }
            } }
        }
    }
}

/** Register a portal while keeping the caller's latest state and callbacks. No visible DOM UI. */
@Composable internal fun TinglanModalPanel(
    identity:String=model.dialog+"|"+model.target,
    onDismissRequest:()->Unit,
    width:Dp=560.dp,
    shape:Shape=RoundedCornerShape(26.dp),
    color:Color=MaterialTheme.colorScheme.surfaceContainer,
    alignment:Alignment=Alignment.Center,
    fullHeight:Boolean=false,
    fromBottom:Boolean=false,
    dim:Boolean=true,
    content:@Composable (titleTag:String)->Unit,
) {
    val owner=LocalModalOwner.current
    val latestContent=rememberUpdatedState(content)
    val latestDismiss=rememberUpdatedState(onDismissRequest)
    val style=rememberUpdatedState(ModalStyle(width,shape,color,alignment,fullHeight,fromBottom,dim))
    val entry=remember(owner,identity) {ModalEntry(latestContent,latestDismiss,style)}
    DisposableEffect(entry) {owner.add(entry);onDispose {owner.close(entry)}}
}
